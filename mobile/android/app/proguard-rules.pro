# Kotlinx Serialization — keep serializer lookup for @Serializable data classes
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class **$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}

# Retrofit (+ OkHttp) baseline
-dontwarn retrofit2.**
-keepattributes Signature, Exceptions
-keepclasseswithmembers class * { @retrofit2.http.* <methods>; }

# Hilt
-keep class dagger.hilt.** { *; }
