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
import javax.inject.Inject
import javax.inject.Singleton

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Singleton
class PlaybackConnectionManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private val _player = MutableStateFlow<Player?>(null)
    val player: StateFlow<Player?> = _player.asStateFlow()

    fun getPlayer(onConnected: (Player) -> Unit) {
        val current = _player.value
        if (current != null) {
            onConnected(current)
            return
        }

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
                try {
                    val controller = future.get()
                    _player.value = controller
                    onConnected(controller)
                } catch (e: Exception) {
                    android.util.Log.e("KuraPlayback", "No se pudo conectar con KuraPlaybackService", e)
                    controllerFuture = null
                }
            },
            ContextCompat.getMainExecutor(context)
        )
    }

    /**
     * The service-hosted player outlives any single screen. When the player screen is replaced by the
     * next episode, the outgoing ViewModel is cleared *after* the incoming one has started loading,
     * so "stop on clear" must only happen if nobody else has taken the player over in the meantime.
     */
    @Volatile
    private var owner: Any? = null

    fun claim(newOwner: Any) {
        owner = newOwner
    }

    /** Stops playback if [candidate] is still the current owner. Returns true when it did. */
    fun stopIfOwner(candidate: Any): Boolean {
        if (owner !== candidate) return false
        owner = null
        _player.value?.let {
            it.stop()
            it.clearMediaItems()
        }
        return true
    }

    fun release() {
        controllerFuture?.let {
            MediaController.releaseFuture(it)
        }
        controllerFuture = null
        _player.value = null
    }
}
