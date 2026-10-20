package com.lumaread.quoteshare

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

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
    fun shareImage(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ShareImageArgs::class.java)
            // Only the latest card is kept; older ones were already handed off
            val dir = File(activity.cacheDir, "quoteshare").apply {
                mkdirs()
                listFiles()?.forEach { it.delete() }
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
