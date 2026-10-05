package com.kurastream.app

import android.os.Bundle
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
                val hasToken = tokenStorage.hasToken()
                val hasProfile = !prefs?.activeProfileId.isNullOrBlank()
                when {
                    !hasServer -> Screen.ServerSetup.route
                    !hasToken -> Screen.Login.route
                    !hasProfile -> Screen.ProfileSelect.route
                    else -> Screen.Home.route
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
