package com.lumaread.lansync

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.ParcelFileDescriptor
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class BindWifiArgs {
    var fd: Int = -1
}

private const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

// Holds a multicast lock while the Sync page is open, so discovery broadcasts from other devices arrive.
// Also pins a socket to Wi-Fi: Android returns EPERM for LAN broadcast when mobile data is the default network.
@TauriPlugin(
    permissions = [
        Permission(strings = [LOCAL_NETWORK], alias = "localNetwork"),
    ]
)
class LanSyncPlugin(private val activity: Activity) : Plugin(activity) {
    private val lock: WifiManager.MulticastLock by lazy {
        (activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createMulticastLock("lumaread-sync").apply { setReferenceCounted(false) }
    }

    @Command
    fun ensureLocalNetwork(invoke: Invoke) {
        // Older Android grants this with INTERNET. Android 17 (One UI 9) blocks LAN traffic until the user allows it.
        if (Build.VERSION.SDK_INT < 37 || activity.checkSelfPermission(LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED) {
            invoke.resolve()
            return
        }
        requestPermissionForAlias("localNetwork", invoke, "localNetworkResult")
    }

    @PermissionCallback
    fun localNetworkResult(invoke: Invoke) {
        if (activity.checkSelfPermission(LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED) {
            invoke.resolve()
        } else {
            invoke.reject("Allow Nearby devices for LumaRead, then open Sync again.")
        }
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

    @Command
    fun bindWifi(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(BindWifiArgs::class.java)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Missing socket")
            return
        }
        if (args.fd < 0) {
            invoke.reject("Missing socket")
            return
        }
        try {
            val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val wifi = cm.allNetworks.firstOrNull { network ->
                cm.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            } ?: run {
                invoke.reject("This phone has no Wi-Fi network")
                return
            }
            // fromFd duplicates the descriptor, so closing it does not close the Rust socket.
            val dup = ParcelFileDescriptor.fromFd(args.fd)
            try {
                wifi.bindSocket(dup.fileDescriptor)
            } finally {
                dup.close()
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Could not use Wi-Fi")
        }
    }
}
