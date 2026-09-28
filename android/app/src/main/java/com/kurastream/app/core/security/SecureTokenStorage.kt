package com.kurastream.app.core.security

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
    fun getToken(): String?
    fun saveToken(token: String)
    fun clearToken()
    fun hasToken(): Boolean
}

/**
 * Android Keystore AES-GCM encrypted token storage.
 * Secret keys remain securely in the Android Keystore hardware-backed provider (minSdk 26).
 * Tokens are never stored in plain text in SharedPreferences or Room.
 */
class SecureTokenStorage(private val context: Context) : TokenStorage {

    private val keyAlias = "kurastream_jwt_key_v1"
    private val keyStoreType = "AndroidKeyStore"
    private val prefsName = "kurastream_secure_sec_prefs"
    private val keyEncryptedToken = "enc_jwt"
    private val keyIv = "enc_iv"

    private val lock = Any()

    init {
        ensureKeyExists()
    }

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

    override fun getToken(): String? {
        synchronized(lock) {
            val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            val encBase64 = prefs.getString(keyEncryptedToken, null) ?: return null
            val ivBase64 = prefs.getString(keyIv, null) ?: return null

            return try {
                val encryptedBytes = Base64.decode(encBase64, Base64.NO_WRAP)
                val iv = Base64.decode(ivBase64, Base64.NO_WRAP)

                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                val spec = GCMParameterSpec(128, iv)
                cipher.init(Cipher.DECRYPT_MODE, getSecretKey(), spec)

                val decryptedBytes = cipher.doFinal(encryptedBytes)
                String(decryptedBytes, Charsets.UTF_8)
            } catch (e: Exception) {
                // If decryption fails due to key invalidation, clear invalid tokens immediately
                clearToken()
                null
            }
        }
    }

    override fun saveToken(token: String) {
        synchronized(lock) {
            try {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, getSecretKey())
                val iv = cipher.iv
                val encryptedBytes = cipher.doFinal(token.toByteArray(Charsets.UTF_8))

                val encBase64 = Base64.encodeToString(encryptedBytes, Base64.NO_WRAP)
                val ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP)

                // Atomic commit to replace the previous token instantly
                context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                    .edit()
                    .putString(keyEncryptedToken, encBase64)
                    .putString(keyIv, ivBase64)
                    .commit()
            } catch (e: Exception) {
                // Safe failure recovery
                ensureKeyExists()
            }
        }
    }

    override fun clearToken() {
        synchronized(lock) {
            context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                .edit()
                .remove(keyEncryptedToken)
                .remove(keyIv)
                .commit()
        }
    }

    override fun hasToken(): Boolean {
        synchronized(lock) {
            return !getToken().isNullOrBlank()
        }
    }
}
