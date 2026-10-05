package com.kurastream.app.core.security

import android.annotation.SuppressLint
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface TokenStorage {
    fun getToken(serverKey: String? = null): String?
    fun saveToken(token: String, serverKey: String? = null)
    fun clearToken(serverKey: String? = null)
    fun clearAllTokens()
    fun hasToken(serverKey: String? = null): Boolean
}

/**
 * Android Keystore AES-GCM encrypted token storage.
 * Secret keys remain securely in the Android Keystore hardware-backed provider (minSdk 26).
 * Tokens are never stored in plain text in SharedPreferences or Room.
 * Provides per-server cryptographic isolation so tokens for server A never leak to server B.
 */
@SuppressLint("ApplySharedPref")
class SecureTokenStorage(
    private val context: Context,
    private val activeServerKeyProvider: (() -> String?)? = null
) : TokenStorage {

    private val keyAlias = "kurastream_jwt_key_v1"
    private val keyStoreType = "AndroidKeyStore"
    private val prefsName = "kurastream_secure_sec_prefs"
    private val legacyTokenKey = "enc_jwt"
    private val legacyIvKey = "enc_iv"

    private val lock = Any()

    /**
     * Some devices have a broken or unavailable Keystore (factory-reset oddities, custom ROMs). The app used to crash
     * while being created. Now a key that cannot be created or repaired means tokens are kept in memory only: the
     * person signs in again after the app is restarted, but the app works.
     */
    @Volatile
    private var keystoreUsable: Boolean = false
    private val memoryTokens = HashMap<String, String>()

    init {
        keystoreUsable = tryEnsureKey()
    }

    private fun tryEnsureKey(): Boolean {
        return try {
            ensureKeyExists()
            true
        } catch (_: Exception) {
            try {
                KeyStore.getInstance(keyStoreType).apply { load(null) }.deleteEntry(keyAlias)
                ensureKeyExists()
                true
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun sanitizeKey(rawKey: String?): String {
        val key = rawKey?.ifBlank { null } ?: activeServerKeyProvider?.invoke()?.ifBlank { null } ?: "default"
        return key.replace(Regex("[^a-zA-Z0-9_]"), "_")
    }

    private fun tokenKey(serverKey: String?): String = "enc_jwt_${sanitizeKey(serverKey)}"
    private fun ivKey(serverKey: String?): String = "enc_iv_${sanitizeKey(serverKey)}"

    private fun ensureKeyExists() {
        val keyStore = KeyStore.getInstance(keyStoreType).apply { load(null) }
        if (!keyStore.containsAlias(keyAlias)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                keyStoreType
            )
            val keyGenSpec = KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()

            keyGenerator.init(keyGenSpec)
            keyGenerator.generateKey()
        }
    }

    private fun getSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(keyStoreType).apply { load(null) }
        return keyStore.getKey(keyAlias, null) as SecretKey
    }

    override fun getToken(serverKey: String?): String? {
        synchronized(lock) {
            if (!keystoreUsable) return memoryTokens[sanitizeKey(serverKey)]
            val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            val tKey = tokenKey(serverKey)
            val iKey = ivKey(serverKey)

            var encBase64 = prefs.getString(tKey, null)
            var ivBase64 = prefs.getString(iKey, null)

            // Fallback to legacy single-token storage if matching default
            if (encBase64 == null && (serverKey == null || sanitizeKey(serverKey) == "default")) {
                encBase64 = prefs.getString(legacyTokenKey, null)
                ivBase64 = prefs.getString(legacyIvKey, null)
            }

            if (encBase64 == null || ivBase64 == null) return null

            return try {
                val encryptedBytes = Base64.decode(encBase64, Base64.NO_WRAP)
                val iv = Base64.decode(ivBase64, Base64.NO_WRAP)

                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                val spec = GCMParameterSpec(128, iv)
                cipher.init(Cipher.DECRYPT_MODE, getSecretKey(), spec)

                val decryptedBytes = cipher.doFinal(encryptedBytes)
                String(decryptedBytes, Charsets.UTF_8)
            } catch (e: Exception) {
                clearToken(serverKey)
                null
            }
        }
    }

    override fun saveToken(token: String, serverKey: String?) {
        synchronized(lock) {
            if (!keystoreUsable) {
                memoryTokens[sanitizeKey(serverKey)] = token
                return
            }
            try {
                fun encrypt(): Pair<ByteArray, ByteArray> {
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.ENCRYPT_MODE, getSecretKey())
                    return Pair(cipher.doFinal(token.toByteArray(Charsets.UTF_8)), cipher.iv)
                }
                val encrypted = try {
                    encrypt()
                } catch (_: Exception) {
                    // The key was lost or invalidated: make a new one and encrypt once more.
                    keystoreUsable = tryEnsureKey()
                    if (!keystoreUsable) {
                        memoryTokens[sanitizeKey(serverKey)] = token
                        return
                    }
                    encrypt()
                }
                val encryptedBytes = encrypted.first
                val iv = encrypted.second

                val encBase64 = Base64.encodeToString(encryptedBytes, Base64.NO_WRAP)
                val ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP)

                val tKey = tokenKey(serverKey)
                val iKey = ivKey(serverKey)

                // Atomic commit to replace the previous token instantly for this server
                val editor = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
                editor.putString(tKey, encBase64)
                editor.putString(iKey, ivBase64)
                if (serverKey == null || sanitizeKey(serverKey) == "default") {
                    editor.putString(legacyTokenKey, encBase64)
                    editor.putString(legacyIvKey, ivBase64)
                }
                editor.commit()
            } catch (_: Exception) {
                // Could not store it securely: keep it for this run so the session still works.
                memoryTokens[sanitizeKey(serverKey)] = token
            }
        }
    }

    override fun clearToken(serverKey: String?) {
        synchronized(lock) {
            memoryTokens.remove(sanitizeKey(serverKey))
            val tKey = tokenKey(serverKey)
            val iKey = ivKey(serverKey)
            val editor = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
            editor.remove(tKey)
            editor.remove(iKey)
            if (serverKey == null || sanitizeKey(serverKey) == "default") {
                editor.remove(legacyTokenKey)
                editor.remove(legacyIvKey)
            }
            editor.commit()
        }
    }

    override fun clearAllTokens() {
        synchronized(lock) {
            memoryTokens.clear()
            context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit()
        }
    }

    override fun hasToken(serverKey: String?): Boolean {
        synchronized(lock) {
            return !getToken(serverKey).isNullOrBlank()
        }
    }
}
