package com.kurastream.app.core.model

/**
 * Offline fallback for "Continuar viendo", mirroring /api/history/continue: one card per show
 * from its most recently watched episode, and only while that episode is unfinished. Taking the
 * newest *unfinished* episode instead resurfaced an old half-watched one after the whole series
 * had been watched.
 */
object ContinueWatchingRules {
    fun fromHistory(history: List<WatchHistoryItem>): List<WatchHistoryItem> {
        return history
            .groupBy { it.showId.ifBlank { it.episodeId } }
            .values
            .map { rows ->
                rows.maxWith(
                    compareBy<WatchHistoryItem> { it.updatedAt }
                        .thenBy { it.seasonNumber }
                        .thenBy { it.episodeNumber }
                )
            }
            .filter { isUnfinished(it) }
            .sortedByDescending { it.updatedAt }
    }

    private fun isUnfinished(item: WatchHistoryItem): Boolean {
        if (item.completed || item.progressSeconds <= 10f) return false
        return item.duration <= 0f || item.progressSeconds < item.duration * 0.9f
    }
}
