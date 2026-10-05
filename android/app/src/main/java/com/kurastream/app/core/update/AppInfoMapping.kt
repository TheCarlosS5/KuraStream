package com.kurastream.app.core.update

import com.kurastream.app.core.network.dto.AppInfoDto

/** Pure decision, kept apart from Android so it is unit-tested: is the announced build newer than this one? */
fun AppInfoDto.toUpdate(currentVersionCode: Int): AppUpdate? {
    if (!available) return null
    val code = versionCode ?: return null
    val sha = sha256?.takeIf { it.length == 64 } ?: return null
    val url = downloadUrl?.takeIf { it.startsWith("/") } ?: return null
    if (code <= currentVersionCode) return null
    return AppUpdate(
        versionName = version ?: code.toString(),
        versionCode = code,
        notes = notes?.takeIf { it.isNotBlank() },
        sha256 = sha,
        sizeBytes = sizeBytes ?: 0L,
        downloadUrl = url
    )
}
