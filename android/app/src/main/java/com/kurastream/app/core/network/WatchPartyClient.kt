package com.kurastream.app.core.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import com.kurastream.app.core.model.PartyMessage
import com.kurastream.app.core.model.PartySyncEvent
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit
import kotlin.random.Random

sealed interface PartyRealtimeEvent {
    data class Sync(val sync: PartySyncEvent) : PartyRealtimeEvent
    data class Message(val message: PartyMessage) : PartyRealtimeEvent
    data class MessagesBatch(val messages: List<PartyMessage>) : PartyRealtimeEvent
    data class MemberJoined(val username: String) : PartyRealtimeEvent
    data class MemberLeft(val username: String) : PartyRealtimeEvent
    data class MembersUpdated(val members: List<String>) : PartyRealtimeEvent
    data object RoomClosed : PartyRealtimeEvent
    data object TicketExpiring : PartyRealtimeEvent
    data class ConnectionError(val error: Throwable) : PartyRealtimeEvent
}

/** The server ends a stream now and then on purpose; reopening it is routine, not a failure. */
private const val RECONNECT_DELAY_MS = 300L
/** After real failures the wait grows 1 s, 2 s, 4 s ... up to a minute (plus jitter), so a server that is down is not hammered. */
private const val BACKOFF_BASE_MS = 1_000L
private const val BACKOFF_MAX_MS = 60_000L
/** The server pings every few seconds: silence for this long means the connection is dead (Wi-Fi dropped without a close). */
private const val STREAM_READ_TIMEOUT_SECONDS = 30L
/** Answers that mean "this room/member no longer exists": retrying is pointless, the session is over. */
private val SESSION_ENDED_CODES = setOf(401, 403, 404)

class WatchPartyClient(
    private val okHttpClient: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val context: Context? = null
) {
    private var eventSource: EventSource? = null
    private var pollingJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _events = MutableSharedFlow<PartyRealtimeEvent>(extraBufferCapacity = 64)
    val events = _events.asSharedFlow()

    private var lastMessageId: Int = 0

    /** Bumped on every connect/disconnect so callbacks from an old stream are ignored. */
    @Volatile
    private var generation = 0
    private var reconnectJob: Job? = null
    private var reconnectAttempt = 0

    private data class Connection(val baseUrl: String, val roomId: String, val memberId: String?, val memberToken: String?)
    @Volatile
    private var connection: Connection? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    fun connect(
        baseUrl: String,
        roomId: String,
        sseTicket: String?,
        memberId: String?,
        memberToken: String?
    ) {
        disconnect()
        connection = Connection(baseUrl, roomId, memberId, memberToken)
        registerNetworkCallback()
        openStream(++generation, baseUrl, roomId, sseTicket, memberId, memberToken)
    }

    /** Wait before the next attempt after a failure: exponential with jitter, capped at a minute. */
    private fun nextBackoffMs(): Long {
        val base = minOf(BACKOFF_MAX_MS, BACKOFF_BASE_MS shl minOf(reconnectAttempt, 6))
        reconnectAttempt++
        return base + Random.nextLong(0, base / 4 + 1)
    }

    /**
     * A different network (Wi-Fi to mobile data, a hotspot coming back) usually leaves the old connection silently
     * dead: reconnect at once instead of waiting for the read timeout and the backoff.
     */
    private fun registerNetworkCallback() {
        val manager = context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        unregisterNetworkCallback()
        val callback = object : ConnectivityManager.NetworkCallback() {
            private var first = true
            override fun onAvailable(network: Network) {
                // The first callback reports the network we are already on.
                if (first) { first = false; return }
                reconnectNow()
            }
        }
        try {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: Exception) {
            // Missing permission or a restricted profile: the backoff still brings the stream back.
        }
    }

    private fun unregisterNetworkCallback() {
        val callback = networkCallback ?: return
        networkCallback = null
        try {
            (context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    /** Drops the current stream and opens a new one immediately (network change, app back in the foreground). */
    fun reconnectNow() {
        val current = connection ?: return
        reconnectJob?.cancel()
        reconnectAttempt = 0
        eventSource?.cancel()
        openStream(++generation, current.baseUrl, current.roomId, null, current.memberId, current.memberToken)
    }

    /** The room is gone or this member was removed: tell the app once and stop every retry. */
    private fun endSession() {
        _events.tryEmit(PartyRealtimeEvent.RoomClosed)
        disconnect()
    }

    /**
     * The server ends every stream after ~25 s on purpose (proxy friendliness). Without reopening it
     * here guests stopped receiving sync frames half a minute into the party. Reconnects go without
     * the (short-lived) SSE ticket: the member headers authenticate the stream on their own.
     */
    private fun openStream(
        gen: Int,
        baseUrl: String,
        roomId: String,
        sseTicket: String?,
        memberId: String?,
        memberToken: String?
    ) {
        val baseClean = baseUrl.trimEnd('/')
        val url = "$baseClean/api/party/stream?room_id=$roomId&last_msg_id=$lastMessageId" +
                if (!sseTicket.isNullOrBlank()) "&sse_ticket=$sseTicket" else ""

        val request = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .apply {
                if (!memberId.isNullOrBlank()) header("X-Party-Member-Id", memberId)
                if (!memberToken.isNullOrBlank()) header("X-Party-Member-Token", memberToken)
            }
            .build()

        val sseClient = okHttpClient.newBuilder()
            .readTimeout(STREAM_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .build()

        val factory = EventSources.createFactory(sseClient)
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                if (gen != generation) return
                // Live again: the polling fallback is no longer needed.
                pollingJob?.cancel()
                pollingJob = null
                reconnectAttempt = 0
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (gen != generation) return
                parseAndEmitEvent(type, data)
            }

            override fun onClosed(eventSource: EventSource) {
                if (gen != generation) return
                scheduleReconnect(gen, baseUrl, roomId, memberId, memberToken, RECONNECT_DELAY_MS)
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                if (gen != generation) return
                if (response != null && response.code in SESSION_ENDED_CODES) {
                    endSession()
                    return
                }
                _events.tryEmit(PartyRealtimeEvent.ConnectionError(t ?: Exception("SSE desconectado")))
                // Poll while the stream is down, and keep trying to get the stream back (with growing waits).
                startPollingFallback(baseUrl, roomId, memberId, memberToken)
                scheduleReconnect(gen, baseUrl, roomId, memberId, memberToken, nextBackoffMs())
            }
        })
    }

    private fun scheduleReconnect(
        gen: Int,
        baseUrl: String,
        roomId: String,
        memberId: String?,
        memberToken: String?,
        delayMs: Long
    ) {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            if (gen == generation) openStream(gen, baseUrl, roomId, null, memberId, memberToken)
        }
    }

    private fun parseAndEmitEvent(type: String?, data: String) {
        try {
            val element = json.parseToJsonElement(data)
            when (type) {
                "init" -> {
                    // data: {"room": {...}, "messages": [...], "members": [...]}
                    val obj = element.jsonObject
                    val roomObj = obj["room"]?.jsonObject
                    if (roomObj != null) {
                        _events.tryEmit(PartyRealtimeEvent.Sync(parseSyncEvent(roomObj)))
                    }
                    val membersArr = obj["members"]?.jsonArray
                    if (membersArr != null) {
                        val memberNames = membersArr.mapNotNull {
                            it.jsonObject["username"]?.jsonPrimitive?.contentOrNull
                        }
                        if (memberNames.isNotEmpty()) {
                            _events.tryEmit(PartyRealtimeEvent.MembersUpdated(memberNames))
                        }
                    }
                    val msgArr = obj["messages"]?.jsonArray
                    if (msgArr != null) {
                        val msgs = msgArr.mapNotNull { parsePartyMessage(it) }
                        if (msgs.isNotEmpty()) {
                            _events.tryEmit(PartyRealtimeEvent.MessagesBatch(msgs))
                        }
                    }
                }
                "sync" -> {
                    // data: currentRoom object
                    _events.tryEmit(PartyRealtimeEvent.Sync(parseSyncEvent(element.jsonObject)))
                }
                "messages" -> {
                    // data: [ {...}, {...} ]
                    val arr = element.jsonArray
                    val msgs = arr.mapNotNull { parsePartyMessage(it) }
                    if (msgs.isNotEmpty()) {
                        _events.tryEmit(PartyRealtimeEvent.MessagesBatch(msgs))
                    }
                }
                "room_closed" -> {
                    _events.tryEmit(PartyRealtimeEvent.RoomClosed)
                }
                "ping" -> {
                    // Heartbeat keep-alive; no action needed
                }
            }
        } catch (_: Exception) {
            // Ignore malformed event frames
        }
    }

    private fun parseSyncEvent(room: JsonObject): PartySyncEvent {
        val isPlaying = room["is_playing"]?.jsonPrimitive?.booleanOrNull
            ?: (room["is_playing"]?.jsonPrimitive?.intOrNull == 1)
        return PartySyncEvent(
            currentTime = room["current_time"]?.jsonPrimitive?.floatOrNull ?: 0f,
            isPlaying = isPlaying,
            updatedBy = room["host_user"]?.jsonPrimitive?.contentOrNull ?: "",
            playbackRate = room["playback_rate"]?.jsonPrimitive?.floatOrNull ?: 1.0f,
            episodeId = room["episode_id"]?.jsonPrimitive?.contentOrNull,
            lastSyncTimestampMs = room["last_sync_timestamp"]?.jsonPrimitive?.longOrNull ?: 0L,
            serverTimeMs = room["server_time_ms"]?.jsonPrimitive?.longOrNull ?: 0L,
            receivedAtMs = System.currentTimeMillis()
        )
    }

    private fun parsePartyMessage(element: JsonElement): PartyMessage? {
        return try {
            val obj = element.jsonObject
            val id = obj["id"]?.jsonPrimitive?.intOrNull ?: 0
            if (id > lastMessageId) {
                lastMessageId = id
            }
            val user = obj["username"]?.jsonPrimitive?.contentOrNull ?: "Usuario"
            val msg = obj["message"]?.jsonPrimitive?.contentOrNull ?: ""
            val time = obj["created_at"]?.jsonPrimitive?.contentOrNull
                ?: obj["timestamp"]?.jsonPrimitive?.contentOrNull ?: ""
            val type = obj["type"]?.jsonPrimitive?.contentOrNull ?: "chat"
            PartyMessage(id = id.toString(), username = user, message = msg, timestamp = time, type = type)
        } catch (_: Exception) {
            null
        }
    }

    private fun startPollingFallback(
        baseUrl: String,
        roomId: String,
        memberId: String?,
        memberToken: String?
    ) {
        if (pollingJob?.isActive == true) return
        pollingJob = scope.launch {
            val baseClean = baseUrl.trimEnd('/')

            while (isActive) {
                try {
                    val url = "$baseClean/api/party/poll?room_id=$roomId&last_msg_id=$lastMessageId"
                    val req = Request.Builder()
                        .url(url)
                        .apply {
                            if (!memberId.isNullOrBlank()) header("X-Party-Member-Id", memberId)
                            if (!memberToken.isNullOrBlank()) header("X-Party-Member-Token", memberToken)
                        }
                        .build()

                    okHttpClient.newCall(req).execute().use { resp ->
                        if (resp.code in SESSION_ENDED_CODES) {
                            endSession()
                            return@launch
                        }
                        if (resp.isSuccessful) {
                            val body = resp.body?.string()
                            if (!body.isNullOrBlank()) {
                                val root = json.parseToJsonElement(body).jsonObject
                                val room = root["room"]?.jsonObject
                                if (room != null) {
                                    _events.tryEmit(PartyRealtimeEvent.Sync(parseSyncEvent(room)))
                                }
                                val msgsArray = root["messages"]?.jsonArray
                                if (msgsArray != null && msgsArray.isNotEmpty()) {
                                    val msgs = msgsArray.mapNotNull { parsePartyMessage(it) }
                                    if (msgs.isNotEmpty()) {
                                        _events.tryEmit(PartyRealtimeEvent.MessagesBatch(msgs))
                                    }
                                }
                            }
                        }
                    }
                } catch (_: Exception) {
                }
                delay(2000)
            }
        }
    }

    fun disconnect() {
        generation++
        connection = null
        reconnectAttempt = 0
        unregisterNetworkCallback()
        reconnectJob?.cancel()
        reconnectJob = null
        eventSource?.cancel()
        eventSource = null
        pollingJob?.cancel()
        pollingJob = null
        lastMessageId = 0
    }
}
