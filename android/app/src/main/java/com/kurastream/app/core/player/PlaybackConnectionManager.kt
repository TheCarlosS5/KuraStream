package com.kurastream.app.core.player

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.CancellationException
import javax.inject.Inject
import javax.inject.Singleton

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Singleton
class PlaybackConnectionManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var connectionGeneration: Long = 0L
    private val _player = MutableStateFlow<Player?>(null)
    val player: StateFlow<Player?> = _player.asStateFlow()

    private val _connectionError = MutableStateFlow<Throwable?>(null)
    val connectionError: StateFlow<Throwable?> = _connectionError.asStateFlow()

    fun getPlayer(onError: ((Throwable) -> Unit)? = null, onConnected: (Player) -> Unit) {
        val current = _player.value
        if (current != null) {
            _connectionError.value = null
            onConnected(current)
            return
        }

        controllerFuture?.let {
            if (!it.isDone) {
                MediaController.releaseFuture(it)
            }
        }

        val generation = ++connectionGeneration
        val sessionToken = SessionToken(context, ComponentName(context, KuraPlaybackService::class.java))
        val future = MediaController.Builder(context, sessionToken)
            .setListener(object : MediaController.Listener {
                override fun onDisconnected(controller: MediaController) {
                    // Service was killed/released: drop the dead controller so the next screen reconnects.
                    if (_player.value === controller) {
                        _player.value = null
                        controllerFuture = null
                    }
                }
            })
            .buildAsync()
        controllerFuture = future

        future.addListener(
            {
                if (generation != connectionGeneration || controllerFuture !== future) {
                    return@addListener
                }
                try {
                    val controller = future.get()
                    _connectionError.value = null
                    _player.value = controller
                    onConnected(controller)
                } catch (e: Exception) {
                    if (generation != connectionGeneration || controllerFuture !== future) {
                        return@addListener
                    }
                    val cause = e.cause
                    if (e is CancellationException || cause is CancellationException) {
                        return@addListener
                    }
                    android.util.Log.e("KuraPlayback", "No se pudo conectar con KuraPlaybackService", e)
                    _connectionError.value = e
                    controllerFuture = null
                    onError?.invoke(e)
                }
            },
            ContextCompat.getMainExecutor(context)
        )
    }

    fun getPlayer(onConnected: (Player) -> Unit) {
        getPlayer(onError = null, onConnected = onConnected)
    }

    /**
     * The service-hosted player outlives any single screen. When the player screen is replaced by the
     * next episode, the outgoing ViewModel is cleared *after* the incoming one has started loading,
     * so "stop on clear" must only happen if nobody else has taken the player over in the meantime.
     */
    @Volatile
    private var owner: Any? = null
    private var onOwnerRevoked: (() -> Unit)? = null

    /**
     * Hands the player to [newOwner]. The previous owner is told *before* anything else touches the
     * player, so it can freeze its own position: right after this the player holds the new episode, and
     * reading currentPosition then would file the new episode's time under the old one.
     */
    fun claim(newOwner: Any, onRevoked: (() -> Unit)? = null) {
        if (owner !== newOwner) {
            val revoked = onOwnerRevoked
            onOwnerRevoked = null
            revoked?.invoke()
        }
        owner = newOwner
        onOwnerRevoked = onRevoked
    }

    /** Stops playback if [candidate] is still the current owner. Returns true when it did. */
    fun stopIfOwner(candidate: Any): Boolean {
        if (owner !== candidate) return false
        owner = null
        onOwnerRevoked = null
        _player.value?.let {
            it.stop()
            it.clearMediaItems()
        }
        return true
    }

    fun release() {
        connectionGeneration++
        controllerFuture?.let {
            MediaController.releaseFuture(it)
        }
        controllerFuture = null
        _player.value = null
    }
}
