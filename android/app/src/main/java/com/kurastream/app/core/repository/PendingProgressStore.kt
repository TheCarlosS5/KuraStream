package com.kurastream.app.core.repository

/** Who a progress point belongs to. Fixed when the point is recorded, never re-read when it is sent. */
data class ProgressIdentity(
    val serverId: String,
    val username: String,
    val profileId: String
) {
    val isComplete: Boolean
        get() = serverId.isNotBlank() && username.isNotBlank() && profileId.isNotBlank()
}

data class PendingProgress(
    val identity: ProgressIdentity,
    val episodeId: String,
    val positionSeconds: Float,
    val durationSeconds: Float,
    val seq: Long
)

/**
 * Progress points not yet confirmed by the server, kept across process death (the hotspot drops, the
 * app is closed, the phone reboots). One entry per identity and episode: a newer point replaces the
 * older one, including an intentional rewind (150 -> 30 ends at 30).
 */
interface PendingProgressStore {
    /** Records the point and returns its sequence number. */
    fun put(identity: ProgressIdentity, episodeId: String, positionSeconds: Float, durationSeconds: Float): Long

    /** Forgets the entry only if nothing newer replaced it while it was being sent. */
    fun removeIfSeq(identity: ProgressIdentity, episodeId: String, seq: Long)

    /** Removes pending progress for a specific episode of this identity. */
    fun remove(identity: ProgressIdentity, episodeId: String)

    /** Clears all pending progress for this identity. */
    fun clear(identity: ProgressIdentity)

    fun pendingFor(identity: ProgressIdentity): List<PendingProgress>
}

class InMemoryPendingProgressStore : PendingProgressStore {
    private val entries = LinkedHashMap<Pair<ProgressIdentity, String>, PendingProgress>()
    private var nextSeq = 0L

    @Synchronized
    override fun put(identity: ProgressIdentity, episodeId: String, positionSeconds: Float, durationSeconds: Float): Long {
        val seq = ++nextSeq
        entries[identity to episodeId] = PendingProgress(identity, episodeId, positionSeconds, durationSeconds, seq)
        return seq
    }

    @Synchronized
    override fun removeIfSeq(identity: ProgressIdentity, episodeId: String, seq: Long) {
        if (entries[identity to episodeId]?.seq == seq) entries.remove(identity to episodeId)
    }

    @Synchronized
    override fun remove(identity: ProgressIdentity, episodeId: String) {
        entries.remove(identity to episodeId)
    }

    @Synchronized
    override fun clear(identity: ProgressIdentity) {
        entries.keys.removeAll { it.first == identity }
    }

    @Synchronized
    override fun pendingFor(identity: ProgressIdentity): List<PendingProgress> =
        entries.values.filter { it.identity == identity }.sortedBy { it.seq }
}

/** SharedPreferences-backed store; writes are committed synchronously, so callers must be off the main thread. */
class SharedPrefsPendingProgressStore(
    private val prefs: android.content.SharedPreferences
) : PendingProgressStore {

    private fun key(identity: ProgressIdentity, episodeId: String) =
        listOf(identity.serverId, identity.username, identity.profileId, episodeId).joinToString(SEP)

    @Synchronized
    override fun put(identity: ProgressIdentity, episodeId: String, positionSeconds: Float, durationSeconds: Float): Long {
        val seq = prefs.getLong(SEQ_KEY, 0L) + 1
        prefs.edit()
            .putLong(SEQ_KEY, seq)
            .putString(key(identity, episodeId), "$seq$SEP$positionSeconds$SEP$durationSeconds")
            .commit()
        return seq
    }

    @Synchronized
    override fun removeIfSeq(identity: ProgressIdentity, episodeId: String, seq: Long) {
        val k = key(identity, episodeId)
        val stored = prefs.getString(k, null)?.substringBefore(SEP)?.toLongOrNull()
        if (stored == seq) prefs.edit().remove(k).commit()
    }

    @Synchronized
    override fun remove(identity: ProgressIdentity, episodeId: String) {
        prefs.edit().remove(key(identity, episodeId)).commit()
    }

    @Synchronized
    override fun clear(identity: ProgressIdentity) {
        val editor = prefs.edit()
        var hasChanges = false
        prefs.all.forEach { (k, _) ->
            if (k != SEQ_KEY) {
                val idParts = k.split(SEP)
                if (idParts.size == 4) {
                    val owner = ProgressIdentity(idParts[0], idParts[1], idParts[2])
                    if (owner == identity) {
                        editor.remove(k)
                        hasChanges = true
                    }
                }
            }
        }
        if (hasChanges) {
            editor.commit()
        }
    }

    @Synchronized
    override fun pendingFor(identity: ProgressIdentity): List<PendingProgress> =
        prefs.all.mapNotNull { (k, v) ->
            if (k == SEQ_KEY || v !is String) return@mapNotNull null
            val idParts = k.split(SEP)
            val valueParts = v.split(SEP)
            if (idParts.size != 4 || valueParts.size != 3) return@mapNotNull null
            val owner = ProgressIdentity(idParts[0], idParts[1], idParts[2])
            if (owner != identity) return@mapNotNull null
            PendingProgress(
                identity = owner,
                episodeId = idParts[3],
                positionSeconds = valueParts[1].toFloatOrNull() ?: return@mapNotNull null,
                durationSeconds = valueParts[2].toFloatOrNull() ?: 0f,
                seq = valueParts[0].toLongOrNull() ?: return@mapNotNull null
            )
        }.sortedBy { it.seq }

    private companion object {
        // Unit separator: cannot appear in server ids, usernames, profile or episode ids.
        const val SEP = "\u001F"
        const val SEQ_KEY = "__seq"
    }
}
