package com.lumaread.quoteshare

import android.app.Activity
import android.app.PendingIntent
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallApkArgs {
    lateinit var path: String
}

@InvokeArg
class ShareImageArgs {
    lateinit var base64: String
    var fileName: String = "lumaread-quote.png"
    var text: String? = null
    var title: String? = null
}

@TauriPlugin
class QuoteSharePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun installApk(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(InstallApkArgs::class.java)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Missing update file")
            return
        }
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            invoke.reject("Allow LumaRead to install updates, then tap Check for updates again.")
            return
        }
        val file = File(args.path)
        if (!file.isFile) {
            invoke.reject("The update file is missing")
            return
        }
        Thread {
            try {
                val installer = activity.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
                val sessionId = installer.createSession(params)
                installer.openSession(sessionId).use { session ->
                    file.inputStream().use { input ->
                        session.openWrite("lumaread.apk", 0, file.length()).use { output ->
                            input.copyTo(output)
                            session.fsync(output)
                        }
                    }
                    val callback = Intent(activity, UpdateInstallReceiver::class.java)
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                        (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                    val pending = PendingIntent.getBroadcast(activity, sessionId, callback, flags)
                    session.commit(pending.intentSender)
                }
                activity.runOnUiThread { invoke.resolve() }
            } catch (e: Exception) {
                activity.runOnUiThread { invoke.reject(e.message ?: "Could not open the installer") }
            }
        }.start()
    }

    @Command
    fun shareImage(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ShareImageArgs::class.java)
            // Only the latest card is kept; older ones were already handed off
            val dir = File(activity.cacheDir, "quoteshare").apply {
                mkdirs()
                listFiles()?.forEach { if (!it.name.endsWith(".apk")) it.delete() }
            }
            val file = File(dir, args.fileName.replace(Regex("[^A-Za-z0-9._-]"), "_"))
            file.writeBytes(Base64.decode(args.base64, Base64.DEFAULT))

            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.quoteshare.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                args.text?.let { putExtra(Intent.EXTRA_TEXT, it) }
                clipData = ClipData.newRawUri(null, uri) // shows the image preview in the share sheet
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, args.title ?: "Share quote"))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Could not open the share sheet")
        }
    }
}
