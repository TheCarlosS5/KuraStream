package com.kurastream.app.core.update

import com.kurastream.app.core.network.dto.AppInfoDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class AppInfoMappingTest {
    private val sha = "a".repeat(64)
    private fun info(code: Int? = 10, available: Boolean = true, sha256: String? = sha, url: String? = "/api/app/android/download") =
        AppInfoDto(available = available, version = "2.6.0", versionCode = code, sha256 = sha256, sizeBytes = 1234, downloadUrl = url, notes = " ")

    @Test
    fun `a newer build is offered`() {
        val update = info(code = 10).toUpdate(currentVersionCode = 8)
        assertNotNull(update)
        assertEquals("2.6.0", update!!.versionName)
        assertNull(update.notes)   // blank notes are dropped
    }

    @Test
    fun `same, older or unannounced builds are not offered`() {
        assertNull(info(code = 8).toUpdate(8))
        assertNull(info(code = 7).toUpdate(8))
        assertNull(info(code = null).toUpdate(8))
        assertNull(info(available = false).toUpdate(8))
    }

    @Test
    fun `an update without a usable checksum or a relative url is refused`() {
        assertNull(info(sha256 = null).toUpdate(8))
        assertNull(info(sha256 = "short").toUpdate(8))
        assertNull(info(url = "https://elsewhere.example/app.apk").toUpdate(8))
    }
}
