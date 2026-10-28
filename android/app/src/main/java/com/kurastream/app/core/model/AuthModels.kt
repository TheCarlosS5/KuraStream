package com.kurastream.app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class User(
    val username: String,
    val role: String = "user"
)

@Serializable
data class Profile(
    val id: String,
    val username: String,
    val name: String,
    val color: String = "#818CF8",
    val avatarColor: String = "#818CF8",
    val isKids: Boolean = false,
    val hasPin: Boolean = false,
    /** Server-relative photo path (/library/avatars/...), empty when the profile uses its initial. */
    val avatar: String = "",
    /** "G", "PG", "PG-13" or null (no cap). */
    val maxRating: String? = null,
    val dailyLimitMinutes: Int? = null
)

data class SessionState(
    val isAuthenticated: Boolean = false,
    val currentUser: User? = null,
    val activeProfile: Profile? = null,
    val token: String? = null
)
