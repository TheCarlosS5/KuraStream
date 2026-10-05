package com.kurastream.app.navigation

import android.net.Uri

sealed class Screen(val route: String) {
    data object ServerSetup : Screen("server_setup")
    data object Login : Screen("login")
    data object Register : Screen("register")
    data object ProfileSelect : Screen("profile_select")

    // Main Bottom Nav Screens
    data object Home : Screen("home")
    data object Explore : Screen("explore")
    data object Favorites : Screen("favorites")
    data object History : Screen("history")
    data object Settings : Screen("settings")

    // Detail & Sub-features
    data object ShowDetail : Screen("show_detail/{showId}") {
        fun createRoute(showId: String) = "show_detail/${Uri.encode(showId)}"
    }

    data object Player : Screen("player/{episodeId}") {
        fun createRoute(episodeId: String) = "player/${Uri.encode(episodeId)}"
    }

    data object WatchParty : Screen("watch_party")
}
