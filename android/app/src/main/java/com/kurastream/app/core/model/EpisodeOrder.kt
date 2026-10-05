package com.kurastream.app.core.model

/**
 * Playback order of a show, shared by the player and the home screen (same rules as the web):
 * regular seasons first (S1E1, S1E2 … S2E1), specials (season 0) after them, and "next episode"
 * never rolls from the last regular episode into the specials or back.
 */
object EpisodeOrder {

    fun ordered(episodes: List<Episode>): List<Episode> =
        episodes.sortedWith(
            compareBy<Episode> { if (it.seasonNumber == 0) 1 else 0 }
                .thenBy { it.seasonNumber }
                .thenBy { it.episodeNumber }
        )

    fun next(episodes: List<Episode>, currentId: String): Episode? = neighbour(episodes, currentId, +1)

    fun previous(episodes: List<Episode>, currentId: String): Episode? = neighbour(episodes, currentId, -1)

    /** First episode to offer for a show: its first regular episode, or the first special. */
    fun first(episodes: List<Episode>): Episode? = ordered(episodes).firstOrNull()

    private fun neighbour(episodes: List<Episode>, currentId: String, step: Int): Episode? {
        val list = ordered(episodes)
        val index = list.indexOfFirst { it.id == currentId }
        if (index < 0) return null
        val candidate = list.getOrNull(index + step) ?: return null
        val sameGroup = (candidate.seasonNumber == 0) == (list[index].seasonNumber == 0)
        return candidate.takeIf { sameGroup }
    }
}
