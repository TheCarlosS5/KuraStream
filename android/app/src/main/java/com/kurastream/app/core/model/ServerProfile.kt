package com.kurastream.app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class ServerProfile(
    val id: String,
    val displayName: String,
    val baseUrl: String,
    val isHttps: Boolean,
    val lastConnected: Long = System.currentTimeMillis(),
    val isDefault: Boolean = false,
    val version: String? = null
)
