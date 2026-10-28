package com.kurastream.app.core.model

data class BecauseYouWatchedRecommendation(
    val sourceShowTitle: String,
    val recommendations: List<Show>
)

object BecauseYouWatchedRules {

    private val RESTRICTED_AGE_RATINGS = setOf("R", "TV-MA", "18+", "NC-17", "RX", "R18")
    private val RESTRICTED_GENRE_KEYWORDS = listOf("ecchi", "hentai", "erotica")

    fun isAllowedForKids(show: Show): Boolean {
        val age = show.ageRating.uppercase()
        if (age in RESTRICTED_AGE_RATINGS) return false
        val g = show.genres.lowercase()
        return RESTRICTED_GENRE_KEYWORDS.none { g.contains(it) }
    }

    fun normalizeGenres(genres: String): Set<String> {
        if (genres.isBlank()) return emptySet()
        return genres.split(",", ";", "/")
            .map { it.trim().lowercase() }
            .filter { it.isNotBlank() }
            .toSet()
    }

    fun recommend(
        shows: List<Show>,
        history: List<WatchHistoryItem>,
        isKids: Boolean = false,
        limit: Int = 6
    ): BecauseYouWatchedRecommendation? {
        if (shows.isEmpty() || history.isEmpty()) return null

        val sortedHistory = history.sortedByDescending { it.updatedAt }
        val sourceShow = sortedHistory.firstNotNullOfOrNull { item ->
            shows.find { it.id == item.showId }
        } ?: return null

        if (isKids && !isAllowedForKids(sourceShow)) return null

        val sourceGenres = normalizeGenres(sourceShow.genres)
        if (sourceGenres.isEmpty()) return null

        val candidates = shows
            .filter { it.id != sourceShow.id }
            .filter { !isKids || isAllowedForKids(it) }

        val scored = candidates.mapNotNull { candidate ->
            val candidateGenres = normalizeGenres(candidate.genres)
            val commonCount = candidateGenres.intersect(sourceGenres).size
            if (commonCount > 0) candidate to commonCount else null
        }

        if (scored.isEmpty()) return null

        val ranked = scored
            .sortedWith(
                compareByDescending<Pair<Show, Int>> { it.second }
                    .thenByDescending { it.first.rating }
                    .thenByDescending { it.first.year ?: 0 }
                    .thenBy { it.first.title }
                    .thenBy { it.first.id }
            )
            .map { it.first }
            .take(limit)

        if (ranked.isEmpty()) return null

        return BecauseYouWatchedRecommendation(
            sourceShowTitle = sourceShow.title,
            recommendations = ranked
        )
    }
}
