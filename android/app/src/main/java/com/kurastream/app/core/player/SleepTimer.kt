package com.kurastream.app.core.player

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

fun interface SleepTimerClock {
    fun elapsedRealtimeMs(): Long
}

class DefaultSleepTimerClock : SleepTimerClock {
    override fun elapsedRealtimeMs(): Long = System.nanoTime() / 1_000_000L
}

sealed interface SleepTimerMode {
    data object Off : SleepTimerMode
    data class Minutes(val minutes: Int) : SleepTimerMode
    data object EndOfEpisode : SleepTimerMode
}

sealed interface SleepTimerState {
    data object Inactive : SleepTimerState
    data class Active(
        val remainingSeconds: Int?,
        val label: String,
        val isEndOfEpisode: Boolean
    ) : SleepTimerState
    data object Expired : SleepTimerState
}

@Singleton
class SleepTimer @Inject constructor(
    private val clock: SleepTimerClock = DefaultSleepTimerClock()
) {
    private var activeProfileId: String? = null
    private var mode: SleepTimerMode = SleepTimerMode.Off
    private var targetTimeMs: Long? = null
    private var autoAdvanceBlocked: Boolean = false

    private val _state = MutableStateFlow<SleepTimerState>(SleepTimerState.Inactive)
    val state: StateFlow<SleepTimerState> = _state.asStateFlow()

    val currentMode: SleepTimerMode
        get() = mode

    val isEndOfEpisodeMode: Boolean
        get() = mode is SleepTimerMode.EndOfEpisode

    val isActive: Boolean
        get() = _state.value is SleepTimerState.Active

    fun setTimer(timerMode: SleepTimerMode, profileId: String, isWatchParty: Boolean = false) {
        if (isWatchParty) {
            cancel()
            return
        }
        activeProfileId = profileId
        autoAdvanceBlocked = false
        mode = timerMode
        when (timerMode) {
            is SleepTimerMode.Off -> {
                targetTimeMs = null
                _state.value = SleepTimerState.Inactive
            }
            is SleepTimerMode.Minutes -> {
                val now = clock.elapsedRealtimeMs()
                targetTimeMs = now + (timerMode.minutes * 60 * 1000L)
                updateState(now)
            }
            is SleepTimerMode.EndOfEpisode -> {
                targetTimeMs = null
                _state.value = SleepTimerState.Active(
                    remainingSeconds = null,
                    label = "Fin cap.",
                    isEndOfEpisode = true
                )
            }
        }
    }

    fun cancel() {
        mode = SleepTimerMode.Off
        targetTimeMs = null
        autoAdvanceBlocked = false
        _state.value = SleepTimerState.Inactive
    }

    fun onProfileChanged(profileId: String) {
        if (activeProfileId != null && activeProfileId != profileId) {
            cancel()
        }
        activeProfileId = profileId
    }

    fun tick(nowMs: Long = clock.elapsedRealtimeMs()): SleepTimerState {
        return updateState(nowMs)
    }

    private fun updateState(nowMs: Long): SleepTimerState {
        when (val current = mode) {
            is SleepTimerMode.Minutes -> {
                val target = targetTimeMs ?: return SleepTimerState.Inactive
                val remainingMs = target - nowMs
                if (remainingMs <= 0) {
                    autoAdvanceBlocked = true
                    mode = SleepTimerMode.Off
                    targetTimeMs = null
                    val expiredState = SleepTimerState.Expired
                    _state.value = expiredState
                    return expiredState
                } else {
                    val remainingSeconds = (remainingMs / 1000L).toInt()
                    val minutes = remainingSeconds / 60
                    val seconds = remainingSeconds % 60
                    val label = if (minutes >= 60) {
                        "${minutes / 60}:${(minutes % 60).toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
                    } else {
                        "${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}"
                    }
                    val activeState = SleepTimerState.Active(
                        remainingSeconds = remainingSeconds,
                        label = label,
                        isEndOfEpisode = false
                    )
                    _state.value = activeState
                    return activeState
                }
            }
            is SleepTimerMode.EndOfEpisode -> {
                return _state.value
            }
            is SleepTimerMode.Off -> {
                return SleepTimerState.Inactive
            }
        }
    }

    /**
     * Called when an episode reaches its end. If mode was EndOfEpisode, marks expired and blocks auto advance.
     */
    fun onEpisodeEnded(): Boolean {
        if (mode is SleepTimerMode.EndOfEpisode) {
            autoAdvanceBlocked = true
            mode = SleepTimerMode.Off
            _state.value = SleepTimerState.Expired
            return true
        }
        return false
    }

    fun blocksAutoAdvance(): Boolean = autoAdvanceBlocked || mode is SleepTimerMode.EndOfEpisode

    fun clearAutoAdvanceBlock() {
        autoAdvanceBlocked = false
        if (_state.value is SleepTimerState.Expired) {
            _state.value = SleepTimerState.Inactive
        }
    }
}
