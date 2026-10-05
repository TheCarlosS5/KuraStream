package com.kurastream.app.core.player

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat

/** Which video streams this device can decode without help from the server. */
fun interface VideoDecoderSupport {
    fun canDecode(codec: String, bitDepth: Int): Boolean

    companion object {
        /** Nothing is assumed decodable: the server converts everything (the behaviour before direct play). */
        val None = VideoDecoderSupport { _, _ -> false }
    }
}

/**
 * Asks Android's codec list instead of guessing: a phone with a hardware HEVC decoder plays HEVC MKV files
 * straight from the server (no ffmpeg), while one without it keeps asking the server for H.264.
 */
object DeviceVideoDecoders : VideoDecoderSupport {

    private val cache = HashMap<String, Boolean>()

    @Synchronized
    override fun canDecode(codec: String, bitDepth: Int): Boolean {
        val key = "${codec.lowercase().trim()}/$bitDepth"
        return cache.getOrPut(key) {
            try {
                query(codec.lowercase().trim(), bitDepth)
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun query(codec: String, bitDepth: Int): Boolean {
        val mime = mimeFor(codec) ?: return false
        val tenBit = bitDepth > 8
        val infos = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { info ->
            !info.isEncoder && info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
        }
        if (infos.isEmpty()) return false
        if (!tenBit) return true   // every decoder for the type handles the 8-bit base profiles
        val profile = tenBitProfile(mime) ?: return false
        return infos.any { info ->
            info.getCapabilitiesForType(mime).profileLevels.any { it.profile == profile }
        }
    }

    private fun mimeFor(codec: String): String? = when (codec) {
        "h264", "avc", "avc1" -> MediaFormat.MIMETYPE_VIDEO_AVC
        "hevc", "h265", "hvc1", "hev1" -> MediaFormat.MIMETYPE_VIDEO_HEVC
        "vp9" -> MediaFormat.MIMETYPE_VIDEO_VP9
        "av1" -> MediaFormat.MIMETYPE_VIDEO_AV1
        else -> null
    }

    private fun tenBitProfile(mime: String): Int? = when (mime) {
        MediaFormat.MIMETYPE_VIDEO_AVC -> MediaCodecInfo.CodecProfileLevel.AVCProfileHigh10
        MediaFormat.MIMETYPE_VIDEO_HEVC -> MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
        MediaFormat.MIMETYPE_VIDEO_VP9 -> MediaCodecInfo.CodecProfileLevel.VP9Profile2
        MediaFormat.MIMETYPE_VIDEO_AV1 -> MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10
        else -> null
    }
}
