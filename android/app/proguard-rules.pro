# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ==============================
# React Native / Hermes
# ==============================
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Keep all native methods (JNI)
-keepclassmembers class * {
    native <methods>;
}

# Don't warn about missing classes from RN internals
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**
-dontwarn com.facebook.jni.**

# ==============================
# Reanimated
# ==============================
-keep class com.swmansion.reanimated.** { *; }
-dontwarn com.swmansion.reanimated.**

# ==============================
# React Native Gesture Handler
# ==============================
-keep class com.swmansion.gesturehandler.** { *; }
-dontwarn com.swmansion.gesturehandler.**

# ==============================
# React Native Screens
# ==============================
-keep class com.swmansion.rnscreens.** { *; }
-dontwarn com.swmansion.rnscreens.**

# ==============================
# Firebase
# ==============================
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# ==============================
# Google Mobile Ads
# ==============================
-keep class com.google.android.gms.ads.** { *; }
-dontwarn com.google.android.gms.ads.**

# ==============================
# RevenueCat
# ==============================
-keep class com.revenuecat.** { *; }
-dontwarn com.revenuecat.**

# ==============================
# React Native MMKV
# ==============================
-keep class com.mrousavy.** { *; }
-dontwarn com.mrousavy.**

# ==============================
# Nitro Modules
# ==============================
-keep class com.margelo.nitro.** { *; }
-dontwarn com.margelo.nitro.**

# ==============================
# Lottie
# ==============================
-keep class com.airbnb.lottie.** { *; }
-dontwarn com.airbnb.lottie.**

# ==============================
# React Native Compressor
# ==============================
-keep class com.reactnativecompressor.** { *; }
-dontwarn com.reactnativecompressor.**

# ==============================
# Mixpanel
# ==============================
-keep class com.mixpanel.** { *; }
-dontwarn com.mixpanel.**

# ==============================
# BootSplash
# ==============================
-keep class com.zoontek.rnbootsplash.** { *; }
-dontwarn com.zoontek.rnbootsplash.**

# ==============================
# Notifee
# ==============================
-keep class io.invertase.notifee.** { *; }
-dontwarn io.invertase.notifee.**

# ==============================
# Google Sign-In
# ==============================
-keep class com.google.android.gms.auth.** { *; }
-dontwarn com.google.android.gms.auth.**

# ==============================
# React Native SVG
# ==============================
-keep class com.horcrux.svg.** { *; }
-dontwarn com.horcrux.svg.**

# ==============================
# Vector Icons
# ==============================
-keep class com.oblador.vectoricons.** { *; }
-dontwarn com.oblador.vectoricons.**

# ==============================
# General: Keep annotations & JS interfaces
# ==============================
-keepattributes *Annotation*
-keepattributes JavascriptInterface
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Keep the app's own classes
-keep class com.adoptmevaluescalc.** { *; }

# OkHttp (used by RN networking)
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-keep class okio.** { *; }
-dontwarn okio.**
