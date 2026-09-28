package com.kurastream.app.navigation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.theme.KuraColors
import com.kurastream.app.feature.auth.AuthViewModel
import com.kurastream.app.feature.auth.LoginScreen
import com.kurastream.app.feature.auth.RegisterScreen
import com.kurastream.app.feature.detail.ShowDetailScreen
import com.kurastream.app.feature.detail.ShowDetailViewModel
import com.kurastream.app.feature.explore.ExploreScreen
import com.kurastream.app.feature.explore.ExploreViewModel
import com.kurastream.app.feature.favorites.FavoritesScreen
import com.kurastream.app.feature.favorites.FavoritesViewModel
import com.kurastream.app.feature.history.HistoryScreen
import com.kurastream.app.feature.history.HistoryViewModel
import com.kurastream.app.feature.home.HomeScreen
import com.kurastream.app.feature.home.HomeViewModel
import com.kurastream.app.feature.party.WatchPartyScreen
import com.kurastream.app.feature.party.WatchPartyViewModel
import com.kurastream.app.feature.player.PlayerScreen
import com.kurastream.app.feature.player.PlayerViewModel
import com.kurastream.app.feature.profiles.ProfileSelectScreen
import com.kurastream.app.feature.profiles.ProfileViewModel
import com.kurastream.app.feature.server.ServerSetupScreen
import com.kurastream.app.feature.server.ServerSetupViewModel
import com.kurastream.app.feature.settings.SettingsScreen
import com.kurastream.app.feature.settings.SettingsViewModel

data class BottomNavItem(
    val screen: Screen,
    val titleRes: Int,
    val icon: ImageVector
)

val BottomNavItems = listOf(
    BottomNavItem(Screen.Home, R.string.nav_home, Icons.Default.Home),
    BottomNavItem(Screen.Explore, R.string.nav_explore, Icons.Default.Explore),
    BottomNavItem(Screen.Favorites, R.string.nav_my_list, Icons.Default.Bookmark),
    BottomNavItem(Screen.History, R.string.nav_history, Icons.Default.History),
    BottomNavItem(Screen.Settings, R.string.nav_profile, Icons.Default.Person)
)

@Composable
fun AppNavGraph(
    navController: NavHostController,
    startDestination: String,
    modifier: Modifier = Modifier
) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    val showNavigation = currentRoute in BottomNavItems.map { it.screen.route }
    val configuration = LocalConfiguration.current
    val isTabletLayout = configuration.screenWidthDp >= 600

    if (isTabletLayout && showNavigation) {
        // Adaptive NavigationRail for Tablets & Foldables (width >= 600dp)
        Row(modifier = modifier.fillMaxSize()) {
            NavigationRail(
                containerColor = KuraColors.Surface,
                contentColor = KuraColors.Primary,
                modifier = Modifier.fillMaxHeight()
            ) {
                Spacer(modifier = Modifier.height(16.dp))
                BottomNavItems.forEach { item ->
                    val selected = currentRoute == item.screen.route
                    NavigationRailItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(item.screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(imageVector = item.icon, contentDescription = stringResource(item.titleRes)) },
                        label = { Text(stringResource(item.titleRes)) },
                        colors = NavigationRailItemDefaults.colors(
                            selectedIconColor = KuraColors.Primary,
                            selectedTextColor = KuraColors.Primary,
                            unselectedIconColor = KuraColors.TextSecondary,
                            unselectedTextColor = KuraColors.TextSecondary,
                            indicatorColor = KuraColors.PrimarySoft
                        )
                    )
                }
            }
            NavContent(
                navController = navController,
                startDestination = startDestination,
                modifier = Modifier.weight(1f)
            )
        }
    } else {
        // Standard Bottom Navigation for Phones
        Scaffold(
            bottomBar = {
                if (showNavigation) {
                    NavigationBar(
                        containerColor = KuraColors.Surface,
                        contentColor = KuraColors.Primary
                    ) {
                        BottomNavItems.forEach { item ->
                            val selected = currentRoute == item.screen.route
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    navController.navigate(item.screen.route) {
                                        popUpTo(navController.graph.findStartDestination().id) {
                                            saveState = true
                                        }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(imageVector = item.icon, contentDescription = stringResource(item.titleRes)) },
                                label = { Text(stringResource(item.titleRes)) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = KuraColors.Primary,
                                    selectedTextColor = KuraColors.Primary,
                                    unselectedIconColor = KuraColors.TextSecondary,
                                    unselectedTextColor = KuraColors.TextSecondary,
                                    indicatorColor = KuraColors.PrimarySoft
                                )
                            )
                        }
                    }
                }
            },
            containerColor = KuraColors.Background,
            modifier = modifier
        ) { padding ->
            NavContent(
                navController = navController,
                startDestination = startDestination,
                modifier = Modifier.padding(padding)
            )
        }
    }
}

@Composable
private fun NavContent(
    navController: NavHostController,
    startDestination: String,
    modifier: Modifier = Modifier
) {
    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier
    ) {
        // Setup & Auth with Deep Link support (kurastream://server?url=...)
        composable(
            route = "server_setup?url={serverUrl}",
            arguments = listOf(
                navArgument("serverUrl") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            ),
            deepLinks = listOf(
                navDeepLink { uriPattern = "kurastream://server?url={serverUrl}" }
            )
        ) {
            val vm: ServerSetupViewModel = hiltViewModel()
            ServerSetupScreen(
                viewModel = vm,
                onServerConnected = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.ServerSetup.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Login.route) {
            val vm: AuthViewModel = hiltViewModel()
            LoginScreen(
                viewModel = vm,
                onLoginSuccess = {
                    navController.navigate(Screen.ProfileSelect.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
                onNavigateToRegister = {
                    navController.navigate(Screen.Register.route)
                }
            )
        }

        composable(Screen.Register.route) {
            val vm: AuthViewModel = hiltViewModel()
            RegisterScreen(
                viewModel = vm,
                onRegisterSuccess = {
                    navController.navigate(Screen.ProfileSelect.route) {
                        popUpTo(Screen.Register.route) { inclusive = true }
                    }
                },
                onNavigateToLogin = {
                    navController.popBackStack()
                }
            )
        }

        composable(Screen.ProfileSelect.route) {
            val vm: ProfileViewModel = hiltViewModel()
            ProfileSelectScreen(
                viewModel = vm,
                onProfileSelected = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.ProfileSelect.route) { inclusive = true }
                    }
                }
            )
        }

        // Main Tabs
        composable(Screen.Home.route) {
            val vm: HomeViewModel = hiltViewModel()
            HomeScreen(
                viewModel = vm,
                onNavigateToShowDetail = { showId ->
                    navController.navigate(Screen.ShowDetail.createRoute(showId))
                },
                onNavigateToPlayer = { episodeId ->
                    navController.navigate(Screen.Player.createRoute(episodeId))
                },
                onNavigateToWatchParty = {
                    navController.navigate(Screen.WatchParty.route)
                }
            )
        }

        composable(Screen.Explore.route) {
            val vm: ExploreViewModel = hiltViewModel()
            ExploreScreen(
                viewModel = vm,
                onNavigateToShowDetail = { showId ->
                    navController.navigate(Screen.ShowDetail.createRoute(showId))
                }
            )
        }

        composable(Screen.Favorites.route) {
            val vm: FavoritesViewModel = hiltViewModel()
            FavoritesScreen(
                viewModel = vm,
                onNavigateToShowDetail = { showId ->
                    navController.navigate(Screen.ShowDetail.createRoute(showId))
                }
            )
        }

        composable(Screen.History.route) {
            val vm: HistoryViewModel = hiltViewModel()
            HistoryScreen(
                viewModel = vm,
                onNavigateToPlayer = { episodeId ->
                    navController.navigate(Screen.Player.createRoute(episodeId))
                }
            )
        }

        composable(Screen.Settings.route) {
            val vm: SettingsViewModel = hiltViewModel()
            SettingsScreen(
                viewModel = vm,
                onNavigateToProfileSelect = {
                    navController.navigate(Screen.ProfileSelect.route)
                },
                onNavigateToServerSetup = {
                    navController.navigate(Screen.ServerSetup.route)
                },
                onLogoutSuccess = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        // Show Detail with Deep Link support
        composable(
            route = Screen.ShowDetail.route,
            arguments = listOf(navArgument("showId") { type = NavType.StringType }),
            deepLinks = listOf(navDeepLink { uriPattern = "kurastream://show/{showId}" })
        ) {
            val vm: ShowDetailViewModel = hiltViewModel()
            ShowDetailScreen(
                viewModel = vm,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToPlayer = { epId ->
                    navController.navigate(Screen.Player.createRoute(epId))
                }
            )
        }

        // Player Screen with Deep Link support
        composable(
            route = Screen.Player.route,
            arguments = listOf(navArgument("episodeId") { type = NavType.StringType }),
            deepLinks = listOf(navDeepLink { uriPattern = "kurastream://episode/{episodeId}" })
        ) {
            val vm: PlayerViewModel = hiltViewModel()
            PlayerScreen(
                viewModel = vm,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToNextEpisode = { nextEpId ->
                    navController.navigate(Screen.Player.createRoute(nextEpId)) {
                        popUpTo(Screen.Player.route) { inclusive = true }
                    }
                }
            )
        }

        // Watch Party with Deep Link support
        composable(
            route = Screen.WatchParty.route,
            deepLinks = listOf(navDeepLink { uriPattern = "kurastream://party/{roomId}" })
        ) {
            val vm: WatchPartyViewModel = hiltViewModel()
            WatchPartyScreen(
                viewModel = vm,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToPlayerWithTicket = { epId, ticket ->
                    if (ticket.isNotBlank()) {
                        vm.setPartyPlaybackTicket(ticket)
                    }
                    navController.navigate(Screen.Player.createRoute(epId))
                }
            )
        }
    }
}
