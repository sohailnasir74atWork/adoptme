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
    tagTamperedDevice()
    loadReactNative(this)
  }

  private fun tagTamperedDevice() {
    try {
      FirebaseCrashlytics.getInstance().setCustomKey("is_tampered", isTamperedDevice())
    } catch (_: Throwable) {
    }
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
