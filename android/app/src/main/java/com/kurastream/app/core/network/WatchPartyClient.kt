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
    data class MemberJoined(val username: String) : PartyRealtimeEvent
    data class MemberLeft(val username: String) : PartyRealtimeEvent
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
                "party_sync" -> {
                    val obj = element.jsonObject
                    val time = obj["current_time"]?.jsonPrimitive?.floatOrNull ?: 0f
                    val isPlaying = obj["is_playing"]?.jsonPrimitive?.booleanOrNull ?: false
                    val updatedBy = obj["updated_by"]?.jsonPrimitive?.contentOrNull ?: ""
                    val rate = obj["playback_rate"]?.jsonPrimitive?.floatOrNull ?: 1.0f
                    _events.tryEmit(PartyRealtimeEvent.Sync(PartySyncEvent(time, isPlaying, updatedBy, rate)))
                }
                "party_message" -> {
                    val obj = element.jsonObject
                    val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: System.currentTimeMillis().toString()
                    val user = obj["username"]?.jsonPrimitive?.contentOrNull ?: "Usuario"
                    val msg = obj["message"]?.jsonPrimitive?.contentOrNull ?: ""
                    val time = obj["timestamp"]?.jsonPrimitive?.contentOrNull ?: ""
                    _events.tryEmit(PartyRealtimeEvent.Message(PartyMessage(id, user, msg, time)))
                }
                "party_member_join" -> {
                    val user = element.jsonObject["username"]?.jsonPrimitive?.contentOrNull ?: ""
                    _events.tryEmit(PartyRealtimeEvent.MemberJoined(user))
                }
                "party_member_leave" -> {
                    val user = element.jsonObject["username"]?.jsonPrimitive?.contentOrNull ?: ""
                    _events.tryEmit(PartyRealtimeEvent.MemberLeft(user))
                }
                "ticket_expiring" -> {
                    _events.tryEmit(PartyRealtimeEvent.TicketExpiring)
                }
            }
        } catch (_: Exception) {
            // Ignore malformed event frames
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
            var lastSince = System.currentTimeMillis() / 1000
            val baseClean = baseUrl.trimEnd('/')

            while (isActive) {
                try {
                    val url = "$baseClean/api/party/poll?room_id=$roomId&since=$lastSince"
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
                                val eventsArray = root["events"]?.jsonArray
                                eventsArray?.forEach { ev ->
                                    val evObj = ev.jsonObject
                                    val type = evObj["type"]?.jsonPrimitive?.contentOrNull
                                    val data = evObj["data"]?.toString() ?: "{}"
                                    parseAndEmitEvent(type, data)
                                }
                                lastSince = System.currentTimeMillis() / 1000
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
    }
}
