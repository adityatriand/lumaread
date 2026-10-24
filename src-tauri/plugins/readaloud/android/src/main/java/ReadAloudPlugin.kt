package com.lumaread.readaloud

import android.app.Activity
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

@InvokeArg
class SpeakArgs {
    lateinit var text: String
    var lang: String = "en-US"
    var rate: Float = 1f
}

@TauriPlugin
class ReadAloudPlugin(private val activity: Activity) : Plugin(activity) {
    private var tts: TextToSpeech? = null
    private var ready: Boolean? = null // null while the engine starts
    private val waiting = mutableListOf<() -> Unit>()
    // Each speak call stays open until its utterance ends, so the web side can chain sentences
    private val pending = ConcurrentHashMap<String, Invoke>()
    private var serial = 0

    override fun load(webView: android.webkit.WebView) {
        tts = TextToSpeech(activity) { status ->
            ready = status == TextToSpeech.SUCCESS
            waiting.forEach { it() }
            waiting.clear()
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) {}
            override fun onDone(id: String) { pending.remove(id)?.resolve() }
            override fun onStop(id: String, interrupted: Boolean) { pending.remove(id)?.resolve() }
            @Deprecated("Deprecated in Java")
            override fun onError(id: String) { pending.remove(id)?.reject("Speech failed") }
        })
    }

    private fun whenReady(block: () -> Unit) = if (ready == null) waiting.add(block) else block()

    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        whenReady {
            val engine = tts
            if (ready != true || engine == null) return@whenReady invoke.reject("No speech engine is installed")
            val result = engine.setLanguage(Locale.forLanguageTag(args.lang))
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                return@whenReady invoke.reject("No offline voice for ${args.lang}. Add one in Android Settings → Text-to-speech.")
            }
            engine.setSpeechRate(args.rate)
            val id = "u${serial++}"
            pending[id] = invoke
            if (engine.speak(args.text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
                pending.remove(id)
                invoke.reject("Speech failed")
            }
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        tts?.stop()
        // stop() doesn't always report onStop for an utterance still queued; release every waiting call
        pending.values.forEach { it.resolve() }
        pending.clear()
        invoke.resolve()
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }
}
