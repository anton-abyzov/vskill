---
description: Gradle version catalog (libs.versions.toml), Material Design 3 dynamic color theming, and type-safe Compose Navigation. Use for Android project dependency setup, MD3 theming, or Navigation 2.8+ routes.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# Jetpack Compose -- Version Catalog, MD3, Type-Safe Navigation

## Version Catalog (libs.versions.toml)

```toml
[versions]
agp = "8.7.3"
kotlin = "2.1.0"
compose-bom = "2025.01.01"
compose-compiler = "2.1.0"  # Matches Kotlin version since K2
lifecycle = "2.8.7"
navigation = "2.8.5"
hilt = "2.53.1"
hilt-navigation-compose = "1.2.0"
room = "2.6.1"
retrofit = "2.11.0"
kotlinx-serialization = "1.7.3"
coroutines = "1.9.0"

[libraries]
compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "compose-bom" }
compose-ui = { group = "androidx.compose.ui", name = "ui" }
compose-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
compose-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
compose-material3 = { group = "androidx.compose.material3", name = "material3" }
compose-ui-test-junit4 = { group = "androidx.compose.ui", name = "ui-test-junit4" }
compose-ui-test-manifest = { group = "androidx.compose.ui", name = "ui-test-manifest" }
lifecycle-runtime-compose = { group = "androidx.lifecycle", name = "lifecycle-runtime-compose", version.ref = "lifecycle" }
lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycle" }
navigation-compose = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigation" }
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-android-compiler", version.ref = "hilt" }
hilt-navigation-compose = { group = "androidx.hilt", name = "hilt-navigation-compose", version.ref = "hilt-navigation-compose" }
room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
room-ktx = { group = "androidx.room", name = "room-ktx", version.ref = "room" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
ksp = { id = "com.google.devtools.ksp", version = "2.1.0-1.0.29" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

### build.gradle.kts (app) -- consuming version catalog

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.example.myapp"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        targetSdk = 35
        testInstrumentationRunner = "com.example.myapp.HiltTestRunner"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.navigation.compose)
    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    ksp(libs.hilt.compiler)
    ksp(libs.room.compiler)

    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
}
```

## Material Design 3 Dynamic Color Theming

```kotlin
// Theme.kt
@Composable
fun MyAppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,  // Material You on Android 12+
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context)
            else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        content = content
    )
}

// Fallback color schemes
val LightColorScheme = lightColorScheme(
    primary = Color(0xFF006D3B),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF9AF6B5),
    secondary = Color(0xFF4F6353),
    surface = Color(0xFFFBFDF8),
    error = Color(0xFFBA1A1A),
)

val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF7EDA9B),
    onPrimary = Color(0xFF00391B),
    primaryContainer = Color(0xFF00522B),
    secondary = Color(0xFFB7CCB9),
    surface = Color(0xFF191C19),
    error = Color(0xFFFFB4AB),
)
```

## Type-Safe Navigation (Navigation 2.8+)

```kotlin
// Routes.kt -- type-safe route definitions
@Serializable
data object Home

@Serializable
data class ProductDetail(val productId: String)

@Serializable
data object Cart

@Serializable
data class OrderConfirmation(val orderId: String)

// AppNavGraph.kt
@Composable
fun AppNavGraph(navController: NavHostController = rememberNavController()) {
    NavHost(navController = navController, startDestination = Home) {
        composable<Home> {
            HomeScreen(
                onProductClick = { productId ->
                    navController.navigate(ProductDetail(productId))
                },
                onCartClick = { navController.navigate(Cart) }
            )
        }

        composable<ProductDetail> { backStackEntry ->
            val route = backStackEntry.toRoute<ProductDetail>()
            ProductDetailScreen(
                productId = route.productId,
                onBack = { navController.popBackStack() }
            )
        }

        composable<Cart> {
            CartScreen(
                onCheckoutComplete = { orderId ->
                    navController.navigate(OrderConfirmation(orderId)) {
                        popUpTo(Home) { inclusive = false }
                    }
                }
            )
        }
    }
}
```
