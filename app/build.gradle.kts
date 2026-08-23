plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.alisson.gpsspeed"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.alisson.gpsspeed"
        minSdk = 24
        targetSdk = 35
        versionCode = 4
        versionName = "1.2.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets["main"].assets.srcDir("src/main/assets")
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.webkit:webkit:1.12.1")
}

tasks.register<Sync>("syncWebAssets") {
    val root = rootProject.projectDir
    into(layout.projectDirectory.dir("src/main/assets/www"))
    from(root.resolve("index.html"))
    from(root.resolve("manifest.json"))
    from(root.resolve("css")) { into("css") }
    from(root.resolve("js")) { into("js") }
    from(root.resolve("pages")) { into("pages") }
    from(root.resolve("assets")) { into("assets") }
}

tasks.named("preBuild") {
    dependsOn("syncWebAssets")
}
