package com.kurastream.app.data

import android.content.Context
import android.content.SharedPreferences

class PreferencesManager(private val sharedPreferences: SharedPreferences) {

    constructor(context: Context) : this(context.getSharedPreferences("kurastream_prefs", Context.MODE_PRIVATE))

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_USERNAME = "username"
    }

    fun saveServerUrl(url: String?) {
        sharedPreferences.edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun getServerUrl(): String? {
        return sharedPreferences.getString(KEY_SERVER_URL, null)
    }

    fun saveAuthToken(token: String?) {
        sharedPreferences.edit().putString(KEY_AUTH_TOKEN, token).apply()
    }

    fun getAuthToken(): String? {
        return sharedPreferences.getString(KEY_AUTH_TOKEN, null)
    }

    fun saveUsername(username: String?) {
        sharedPreferences.edit().putString(KEY_USERNAME, username).apply()
    }

    fun getUsername(): String? {
        return sharedPreferences.getString(KEY_USERNAME, null)
    }

    fun clearAuthSession() {
        sharedPreferences.edit()
            .remove(KEY_AUTH_TOKEN)
            .remove(KEY_USERNAME)
            .apply()
    }
}
