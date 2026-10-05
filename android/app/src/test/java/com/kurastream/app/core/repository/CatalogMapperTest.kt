package com.kurastream.app.core.repository

import com.kurastream.app.core.database.ShowDao
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.dto.CalendarScheduleItemDto
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class CatalogMapperTest {

    @Test
    fun `getCalendarSchedule maps scheduleId correctly for strings, numbers and nulls`() = runBlocking {
        val apiService = mockk<KuraApiService>()
        val showDao = mockk<ShowDao>()
        val repository = CatalogRepository(apiService, showDao)

        val fakeResponse = mapOf(
            "monday" to listOf(
                CalendarScheduleItemDto(
                    scheduleId = JsonPrimitive("123"),
                    title = "Test String ID"
                ),
                CalendarScheduleItemDto(
                    scheduleId = JsonPrimitive(45),
                    title = "Test Number ID"
                ),
                CalendarScheduleItemDto(
                    scheduleId = null,
                    title = "Test Null ID"
                )
            )
        )

        coEvery { apiService.getCalendarSchedule() } returns fakeResponse

        val result = repository.getCalendarSchedule()
        val mappedItems = result.getOrThrow()["monday"]!!

        assertEquals("123", mappedItems[0].scheduleId)
        assertEquals("45", mappedItems[1].scheduleId)
        assertEquals("", mappedItems[2].scheduleId)
    }
}
