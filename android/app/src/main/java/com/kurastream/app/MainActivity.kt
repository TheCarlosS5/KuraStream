package com.kurastream.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.kurastream.app.data.KuraStreamApi
import com.kurastream.app.data.PreferencesManager
import com.kurastream.app.ui.screens.CatalogScreen
import com.kurastream.app.ui.screens.ConnectionScreen
import com.kurastream.app.ui.screens.DetailsScreen
import com.kurastream.app.ui.screens.PlayerScreen
import com.kurastream.app.ui.theme.KuraStreamTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val preferencesManager = PreferencesManager(applicationContext)

        setContent {
            KuraStreamTheme {
                val navController = rememberNavController()
                
                var currentApi by remember {
                    mutableStateOf<KuraStreamApi?>(
                        preferencesManager.getServerUrl()?.let {
                            if (it.isNotBlank()) {
                                try {
                                    KuraStreamApi.create(it, preferencesManager)
                                } catch (e: Exception) {
                                    null
                                }
                            } else {
                                null
                            }
                        }
                    )
                }

                val startDest = if (currentApi == null) "connection" else "catalog"

                NavHost(navController = navController, startDestination = startDest) {
                    composable("connection") {
                        ConnectionScreen(preferencesManager = preferencesManager) {
                            val url = preferencesManager.getServerUrl()
                            if (!url.isNullOrBlank()) {
                                currentApi = KuraStreamApi.create(url, preferencesManager)
                                navController.navigate("catalog") {
                                    popUpTo("connection") { inclusive = true }
                                }
                            }
                        }
                    }
                    composable("catalog") {
                        val api = currentApi
                        if (api != null) {
                            CatalogScreen(
                                api = api,
                                onShowClick = { id -> 
                                    navController.navigate("details/$id") 
                                },
                                onDisconnect = {
                                    preferencesManager.saveServerUrl(null)
                                    preferencesManager.clearAuthSession()
                                    currentApi = null
                                    navController.navigate("connection") {
                                        popUpTo("catalog") { inclusive = true }
                                    }
                                }
                            )
                        } else {
                            // Fallback if session is lost
                            LaunchedEffect(Unit) {
                                navController.navigate("connection") {
                                    popUpTo(0) { inclusive = true }
                                }
                            }
                        }
                    }
                    composable("details/{showId}") { backStackEntry ->
                        val showId = backStackEntry.arguments?.getString("showId") ?: ""
                        val api = currentApi
                        if (api != null) {
                            DetailsScreen(
                                showId = showId,
                                api = api,
                                onEpisodeClick = { epId -> 
                                    navController.navigate("player/$epId") 
                                },
                                onBack = { 
                                    navController.popBackStack() 
                                }
                            )
                        } else {
                            LaunchedEffect(Unit) {
                                navController.navigate("connection") {
                                    popUpTo(0) { inclusive = true }
                                }
                            }
                        }
                    }
                    composable("player/{episodeId}") { backStackEntry ->
                        val episodeId = backStackEntry.arguments?.getString("episodeId") ?: ""
                        val api = currentApi
                        if (api != null) {
                            PlayerScreen(
                                episodeId = episodeId,
                                api = api,
                                preferencesManager = preferencesManager,
                                onBack = { 
                                    navController.popBackStack() 
                                }
                            )
                        } else {
                            LaunchedEffect(Unit) {
                                navController.navigate("connection") {
                                    popUpTo(0) { inclusive = true }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
