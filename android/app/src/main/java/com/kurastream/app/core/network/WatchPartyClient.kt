package com.kurastream.app.core.network

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

class WatchPartyClient(
    private val okHttpClient: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    private var eventSource: EventSource? = null
    private var pollingJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _events = MutableSharedFlow<PartyRealtimeEvent>(extraBufferCapacity = 64)
    val events = _events.asSharedFlow()

    private var lastMessageId: Int = 0

    fun connect(
        baseUrl: String,
        roomId: String,
        sseTicket: String?,
        memberId: String?,
        memberToken: String?
    ) {
        disconnect()

        val baseClean = baseUrl.trimEnd('/')
        val url = "$baseClean/api/party/stream?room_id=$roomId" +
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
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

        val factory = EventSources.createFactory(sseClient)
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                parseAndEmitEvent(type, data)
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                _events.tryEmit(PartyRealtimeEvent.ConnectionError(t ?: Exception("SSE desconectado")))
                // Fallback to polling if SSE encounters an error
                startPollingFallback(baseUrl, roomId, memberId, memberToken)
            }
        })
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
                        val time = roomObj["current_time"]?.jsonPrimitive?.floatOrNull ?: 0f
                        val isPlaying = roomObj["is_playing"]?.jsonPrimitive?.booleanOrNull
                            ?: (roomObj["is_playing"]?.jsonPrimitive?.intOrNull == 1)
                        val host = roomObj["host_user"]?.jsonPrimitive?.contentOrNull ?: ""
                        val episodeId = roomObj["episode_id"]?.jsonPrimitive?.contentOrNull
                        _events.tryEmit(PartyRealtimeEvent.Sync(PartySyncEvent(time, isPlaying, host, 1.0f, episodeId)))
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
                    val obj = element.jsonObject
                    val time = obj["current_time"]?.jsonPrimitive?.floatOrNull ?: 0f
                    val isPlaying = obj["is_playing"]?.jsonPrimitive?.booleanOrNull
                        ?: (obj["is_playing"]?.jsonPrimitive?.intOrNull == 1)
                    val host = obj["host_user"]?.jsonPrimitive?.contentOrNull ?: ""
                    val episodeId = obj["episode_id"]?.jsonPrimitive?.contentOrNull
                    _events.tryEmit(PartyRealtimeEvent.Sync(PartySyncEvent(time, isPlaying, host, 1.0f, episodeId)))
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
            PartyMessage(id = id.toString(), username = user, message = msg, timestamp = time)
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
                        if (resp.isSuccessful) {
                            val body = resp.body?.string()
                            if (!body.isNullOrBlank()) {
                                val root = json.parseToJsonElement(body).jsonObject
                                val room = root["room"]?.jsonObject
                                if (room != null) {
                                    val time = room["current_time"]?.jsonPrimitive?.floatOrNull ?: 0f
                                    val isPlaying = room["is_playing"]?.jsonPrimitive?.booleanOrNull
                                        ?: (room["is_playing"]?.jsonPrimitive?.intOrNull == 1)
                                    val host = room["host_user"]?.jsonPrimitive?.contentOrNull ?: ""
                                    val episodeId = room["episode_id"]?.jsonPrimitive?.contentOrNull
                                    _events.tryEmit(PartyRealtimeEvent.Sync(PartySyncEvent(time, isPlaying, host, 1.0f, episodeId)))
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
        eventSource?.cancel()
        eventSource = null
        pollingJob?.cancel()
        pollingJob = null
        lastMessageId = 0
    }
}
