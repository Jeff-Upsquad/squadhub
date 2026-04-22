plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
    alias(libs.plugins.google.services)
}

android {
    namespace = "com.squadhub.chat"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        // API base URL lives in BuildConfig so flavors can override if needed.
        buildConfigField("String", "API_BASE_URL", "\"https://api.squadhub.in/\"")
    }

    flavorDimensions += "variant"
    productFlavors {
        create("clients") {
            dimension = "variant"
            applicationId = "com.squadhub.chat.clients"
            versionNameSuffix = "-clients"
            buildConfigField("String", "APP_VARIANT", "\"clients\"")
            resValue("string", "app_name", "Squad Chat")
            resValue("string", "push_channel_id", "chat_messages_clients")
            resValue("string", "push_channel_name", "Squad Chat messages")
        }
        create("team") {
            dimension = "variant"
            applicationId = "com.squadhub.chat.team"
            versionNameSuffix = "-team"
            buildConfigField("String", "APP_VARIANT", "\"team\"")
            resValue("string", "app_name", "Squad Chat Team")
            resValue("string", "push_channel_id", "chat_messages_team")
            resValue("string", "push_channel_name", "Squad Chat Team messages")
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
            versionNameSuffix = "-debug"
            // No applicationIdSuffix — debug must match the Firebase-registered
            // package (com.squadhub.chat.clients / com.squadhub.chat.team).
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)

    // Compose
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    debugImplementation(libs.compose.ui.tooling)

    // Navigation
    implementation(libs.androidx.nav.compose)
    implementation(libs.hilt.nav.compose)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)

    // Serialization
    implementation(libs.kotlinx.serialization.json)

    // Networking
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)

    // Room
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    // Images
    implementation(libs.coil.compose)

    // Storage
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)

    // Firebase (FCM) — wired in Phase 3, dep already present so google-services plugin is happy
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
}
