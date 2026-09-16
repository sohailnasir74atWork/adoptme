package com.adoptmevaluescalc

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.google.firebase.crashlytics.FirebaseCrashlytics
import java.io.File


class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    tagTamperedDevice()
  }

  // Off the startup critical path, and off the main thread.
  //
  // This walks 8 filesystem paths and does 3 Class.forName lookups that are
  // EXPECTED to fail — each failure constructs a ClassNotFoundException with a
  // stack trace. On the budget hardware Play Console flags (3-4 GB RAM, slow
  // eMMC) those stats are not free, and every millisecond here lands directly
  // in the cold-start measurement because it ran before loadReactNative.
  //
  // It is pure diagnostics: the result is a Crashlytics custom key nobody reads
  // until a crash is already being investigated, so it has no reason to block
  // the first frame. Running it after loadReactNative on a background thread
  // keeps the same key attached to any crash that follows.
  private fun tagTamperedDevice() {
    Thread {
      try {
        FirebaseCrashlytics.getInstance().setCustomKey("is_tampered", isTamperedDevice())
      } catch (_: Throwable) {
      }
    }.apply {
      // Below default priority: this must never compete with the RN startup
      // threads it was just moved out of the way of.
      priority = Thread.MIN_PRIORITY
      name = "tamper-check"
      isDaemon = true
    }.start()
  }

  private fun isTamperedDevice(): Boolean {
    val tamperClasses = arrayOf(
      "de.robv.android.xposed.XposedBridge",
      "de.robv.android.xposed.XC_MethodHook",
      "com.saurik.substrate.MS",
    )
    for (cls in tamperClasses) {
      try {
        Class.forName(cls)
        return true
      } catch (_: Throwable) {
      }
    }
    val tamperPaths = arrayOf(
      "/system/framework/XposedBridge.jar",
      "/system/lib/libxposed_art.so",
      "/system/lib64/libxposed_art.so",
      "/system/bin/su",
      "/system/xbin/su",
      "/sbin/su",
      "/system/app/Superuser.apk",
      "/data/local/tmp/frida-server",
    )
    for (path in tamperPaths) {
      try {
        if (File(path).exists()) return true
      } catch (_: Throwable) {
      }
    }
    return false
  }
}
