package com.lumaread.quoteshare

import android.app.Activity
import android.content.ClipData
import android.content.Intent
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
import java.net.HttpURLConnection
import java.net.URL

@InvokeArg
class InstallApkArgs {
    lateinit var url: String
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
            invoke.reject(e.message ?: "Missing update address")
            return
        }
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            invoke.reject("Allow LumaRead to install updates, then tap Check for updates again.")
            return
        }
        Thread {
            try {
                val dir = File(activity.cacheDir, "quoteshare").apply { mkdirs() }
                val file = File(dir, "LumaRead-update.apk")
                var current = URL(args.url)
                var conn = current.openConnection() as HttpURLConnection
                var hops = 0
                while (hops < 5) {
                    conn.instanceFollowRedirects = false
                    conn.setRequestProperty("User-Agent", "LumaRead")
                    conn.connectTimeout = 30_000
                    conn.readTimeout = 180_000
                    val code = conn.responseCode
                    if (code !in 300..399) break
                    val next = conn.getHeaderField("Location") ?: break
                    conn.disconnect()
                    current = URL(current, next)
                    conn = current.openConnection() as HttpURLConnection
                    hops++
                }
                if (conn.responseCode !in 200..299) throw IllegalStateException("Download failed (${conn.responseCode})")
                conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
                activity.runOnUiThread {
                    try {
                        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.quoteshare.fileprovider", file)
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        activity.packageManager.queryIntentActivities(intent, 0).forEach { match ->
                            activity.grantUriPermission(match.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        activity.startActivity(intent)
                        invoke.resolve()
                    } catch (e: Exception) {
                        invoke.reject(e.message ?: "Could not open the installer")
                    }
                }
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Could not download the update")
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
