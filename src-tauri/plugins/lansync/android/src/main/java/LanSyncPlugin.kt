package com.lumaread.lansync

import android.app.Activity
import android.content.Context
import android.net.wifi.WifiManager
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

// Holds a multicast lock while the Sync page is open, so discovery broadcasts from other devices arrive
@TauriPlugin
class LanSyncPlugin(private val activity: Activity) : Plugin(activity) {
    private val lock: WifiManager.MulticastLock by lazy {
        (activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createMulticastLock("lumaread-sync").apply { setReferenceCounted(false) }
    }

    @Command
    fun acquire(invoke: Invoke) {
        lock.acquire()
        invoke.resolve()
    }

    @Command
    fun release(invoke: Invoke) {
        if (lock.isHeld) lock.release()
        invoke.resolve()
    }
}
