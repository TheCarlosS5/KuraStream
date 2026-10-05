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
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.runBlocking
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

        // Synchronous bootstrap decision for seamless splash transition
        val startDestination = runBlocking {
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
        }

        setContent {
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
                    startDestination = startDestination
                )
            }
        }
    }
}
