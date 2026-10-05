package com.kurastream.app.core.network

import com.kurastream.app.core.network.dto.CommentsResponseDto
import com.kurastream.app.core.network.dto.NotificationsResponseDto
import com.kurastream.app.core.network.dto.PartyJoinResponseDto
import com.kurastream.app.core.network.dto.ProfilesResponseDto
import com.kurastream.app.core.network.dto.RandomShowResponseDto
import com.kurastream.app.core.network.dto.SelectProfileResponseDto
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

/**
 * Decodes payloads shaped exactly like the PHP API responses, with the same Json settings as AppModule.
 */
class ApiPayloadDecodingTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Test
    fun `profile selection decodes`() {
        val body = """{"success":true,"token":"t","profile":{"id":"prof_1","username":"ana","name":"Principal","avatar":"","color":"#a855f7","is_kids":false,"created_at":"2026-10-02 12:19:45","has_pin":false}}"""
        val res = json.decodeFromString<SelectProfileResponseDto>(body)
        assertEquals("prof_1", res.profile?.id)
        assertFalse(res.profile!!.isKids)
    }

    @Test
    fun `profile list keeps the uploaded photo path`() {
        val body = """{"success":true,"profiles":[{"id":"prof_2","username":"ana","name":"Peques","avatar":"/library/avatars/uploads/avatar_ana_ab12.jpg","color":"#F59E5B","is_kids":true,"has_pin":false},{"id":"prof_3","username":"ana","name":"Sin foto","color":"#818CF8"}]}"""
        val res = json.decodeFromString<ProfilesResponseDto>(body)
        assertEquals("/library/avatars/uploads/avatar_ana_ab12.jpg", res.profiles[0].avatar)
        assertNull(res.profiles[1].avatar)
    }

    @Test
    fun `random show is wrapped in show`() {
        val body = """{"success":true,"show":{"id":"New Game","title":"New Game","rating":7,"year":2016,"tmdb_id":"67012","trailer_key":null}}"""
        val res = json.decodeFromString<RandomShowResponseDto>(body)
        assertEquals("New Game", res.show?.id)
        assertEquals(67012, res.show?.tmdbId)
    }

    @Test
    fun `comments use string ids`() {
        val body = """{"success":true,"comments":[{"id":"comm_3f2a","show_id":"Grand Blue","episode_id":"","username":"ana","profile_name":"Principal","content":"hola","created_at":"2026-10-02 12:19:45","avatar":"","avatar_color":"#a855f7"}]}"""
        val res = json.decodeFromString<CommentsResponseDto>(body)
        assertEquals("comm_3f2a", res.comments.single().id)
    }

    @Test
    fun `notifications use string ids and is_unread`() {
        val body = """{"success":true,"notifications":[{"id":"notif_Grand Blue_S1_E2","show_id":"Grand Blue","show_title":"Grand Blue","poster_path":"","episode_id":"Grand Blue_S1_E2","season_number":1,"episode_number":2,"title":"Ropa interior","message":"Nuevo","created_at":"2026-10-02 12:00:00","is_unread":true}],"unread_count":1,"last_seen_at":null}"""
        val res = json.decodeFromString<NotificationsResponseDto>(body)
        val item = res.notifications.single()
        assertEquals("notif_Grand Blue_S1_E2", item.id)
        assertTrue(item.isUnread)
        assertFalse(item.isRead)
        assertEquals(1, res.unreadCount)
    }

    @Test
    fun `party join reads participants_count`() {
        val body = """{"success":true,"room":{"id":"KURA-1","name":"Sala","host_user":"ana","episode_id":"Grand Blue_S1_E1","is_playing":false,"current_time":0,"last_sync_timestamp":1790961585906,"is_public":true,"allow_guest_controls":true,"participants_count":3},"messages":[{"id":1301,"room_id":"KURA-1","username":"Sistema","message":"hola","type":"system","created_at":"2026-10-02 12:19:45","role":"system"}],"members":[],"user":"ana","member_id":"m","member_token":"t","is_host":true}"""
        val res = json.decodeFromString<PartyJoinResponseDto>(body)
        assertEquals(3, res.room?.memberCount)
        assertEquals(1301, res.messages.single().id)
    }
}
