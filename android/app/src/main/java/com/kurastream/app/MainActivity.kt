package com.kurastream.app

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.kurastream.app.core.network.ServerUrlResolver
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.compose.rememberNavController
import com.kurastream.app.core.designsystem.theme.KuraTheme
import com.kurastream.app.core.network.SessionEvents
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.security.TokenStorage
import com.kurastream.app.navigation.AppNavGraph
import com.kurastream.app.navigation.Screen
import dagger.hilt.android.AndroidEntryPoint
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import javax.inject.Inject

import android.content.Intent
import androidx.navigation.NavHostController

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var tokenStorage: TokenStorage

    @Inject
    lateinit var preferencesDataSource: KuraPreferencesDataSource

    @Inject
    lateinit var sessionEvents: SessionEvents

    private var currentNavController: NavHostController? = null

    /** Where the app starts; null while it is being worked out (the splash screen stays up until it is known). */
    private val startRoute = MutableStateFlow<String?>(null)

    /** Android 17 blocks LAN traffic until the user allows it; the answer itself needs no handling here. */
    private val localNetworkPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** Asked once, when the user already reached the home screen (a sign-in is a better moment than first launch). */
    private fun requestNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33) return
        val prefs = getSharedPreferences("kura_notifications", MODE_PRIVATE)
        if (prefs.getBoolean("permission_asked", false)) return
        prefs.edit().putBoolean("permission_asked", true).apply()
        if (ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch("android.permission.POST_NOTIFICATIONS")
        }
    }

    private fun requestLocalNetworkAccessIfNeeded(serverUrl: String?) {
        if (Build.VERSION.SDK_INT < 37 || serverUrl.isNullOrBlank()) return
        val host = runCatching { android.net.Uri.parse(serverUrl).host }.getOrNull() ?: return
        if (!ServerUrlResolver.isLocalAddress(host)) return
        val permission = "android.permission.ACCESS_LOCAL_NETWORK"
        if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
            localNetworkPermission.launch(permission)
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        com.kurastream.app.core.player.PipController.enterIfArmed(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        currentNavController?.handleDeepLink(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        super.onCreate(savedInstanceState)
        // Always-dark UI: transparent bars with light icons on every API level
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        )

        // The start screen depends on stored preferences and the Keystore. Reading them on the main thread
        // (runBlocking) froze the first frame, and a slow Keystore on some phones ended in an ANR. The splash
        // screen stays up until the answer arrives instead.
        splashScreen.setKeepOnScreenCondition { startRoute.value == null }
        lifecycleScope.launch(Dispatchers.IO) {
            startRoute.value = try {
                val prefs = preferencesDataSource.preferencesFlow.firstOrNull()
                val hasServer = !prefs?.activeServerUrl.isNullOrBlank()
                // A server saved before the phone moved to Android 17 would otherwise fail silently on the first call
                runOnUiThread { requestLocalNetworkAccessIfNeeded(prefs?.activeServerUrl) }
                val hasToken = tokenStorage.hasToken()
                val hasProfile = !prefs?.activeProfileId.isNullOrBlank()
                when {
                    !hasServer -> Screen.ServerSetup.route
                    !hasToken -> Screen.Login.route
                    !hasProfile -> Screen.ProfileSelect.route
                    else -> Screen.Home.route
                }.also { route ->
                    if (route == Screen.Home.route) runOnUiThread { requestNotificationPermissionOnce() }
                }
            } catch (_: Exception) {
                // Unreadable storage: start from the beginning rather than not at all
                Screen.ServerSetup.route
            }
        }

        setContent {
            val startDestination by startRoute.collectAsState()
            val resolvedStart = startDestination ?: return@setContent
            KuraTheme {
                val navController = rememberNavController()
                currentNavController = navController

                // Expired/revoked JWT anywhere in the app -> back to login with a clean back stack.
                LaunchedEffect(navController) {
                    sessionEvents.unauthorized.collect {
                        val route = navController.currentDestination?.route
                        if (route != Screen.Login.route && route != Screen.ServerSetup.route) {
                            navController.navigate(Screen.Login.route) {
                                popUpTo(0) { inclusive = true }
                                launchSingleTop = true
                            }
                        }
                    }
                }
                AppNavGraph(
                    navController = navController,
                    startDestination = resolvedStart
                )
            }
        }
    }
}
