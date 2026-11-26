@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import java.util.Locale
import kotlin.math.abs

// Pistas de audio/subtítulos/calidad y textos legibles para formatos, códecs y tiempos.

// ═══ Pistas ═══
internal fun PlayerActivity.countTracks(type: Int): Int {
    var n = 0
    for (g in player.currentTracks.groups) if (g.type == type) for (i in 0 until g.length) if (g.isTrackSupported(i)) n++
    return n
}

internal fun PlayerActivity.hasOverride(type: Int): Boolean =
    player.trackSelectionParameters.overrides.values.any { it.type == type }

internal fun PlayerActivity.currentTrackLabel(type: Int): String? {
    if (type == C.TRACK_TYPE_TEXT && player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)) return null
    var n = 0
    for (g in player.currentTracks.groups) {
        if (g.type != type) continue
        for (i in 0 until g.length) {
            if (!g.isTrackSupported(i)) continue
            n++
            if (g.isTrackSelected(i)) return trackLabel(g.getTrackFormat(i), type, n)
        }
    }
    return null
}

internal fun PlayerActivity.trackLabel(f: Format, type: Int, n: Int): String {
    if (type == C.TRACK_TYPE_VIDEO) return if (f.height > 0) resolutionLabel(f.height) else "Calidad $n"
    val lang = languageName(f.language)
    val base = f.label?.takeIf { it.isNotBlank() } ?: lang ?: if (type == C.TRACK_TYPE_AUDIO) "Pista $n" else "Subtítulo $n"
    return if (f.label != null && lang != null && !f.label!!.contains(lang, ignoreCase = true)) "$base ($lang)" else base
}

internal fun PlayerActivity.trackDetail(f: Format, type: Int): String? = when (type) {
    C.TRACK_TYPE_AUDIO -> listOfNotNull(codecName(f.sampleMimeType), if (f.channelCount > 0) channelsLabel(f.channelCount) else null).joinToString("  ·  ").ifEmpty { null }
    C.TRACK_TYPE_VIDEO -> listOfNotNull(if (f.width > 0) "${f.width}×${f.height}" else null, bitrateLabel(f.bitrate)).joinToString("  ·  ").ifEmpty { null }
    else -> codecName(f.sampleMimeType)
}

internal fun languageName(code: String?): String? {
    if (code.isNullOrBlank() || code == "und" || code == C.LANGUAGE_UNDETERMINED) return null
    return try {
        val name = Locale.forLanguageTag(code).getDisplayLanguage(Locale.forLanguageTag("es"))
        if (name.isBlank() || name.equals(code, ignoreCase = true)) code.uppercase()
        else name.replaceFirstChar { it.uppercase() }
    } catch (e: Exception) { code }
}

internal fun codecName(mime: String?): String? = when (mime) {
    null -> null
    "video/avc" -> "H.264"
    "video/hevc" -> "H.265"
    "video/mpeg2" -> "MPEG-2"
    "video/x-vnd.on2.vp9" -> "VP9"
    "video/av01" -> "AV1"
    "audio/mp4a-latm" -> "AAC"
    "audio/ac3" -> "Dolby Digital"
    "audio/eac3" -> "Dolby Digital+"
    "audio/mpeg", "audio/mpeg-L2" -> "MP3/MP2"
    "audio/opus" -> "Opus"
    "application/x-subrip" -> "SRT"
    "text/vtt" -> "WebVTT"
    else -> mime.substringAfter('/').uppercase()
}

internal fun channelsLabel(c: Int) = when (c) {
    1 -> "Mono"; 2 -> "Estéreo"; 6 -> "5.1"; 8 -> "7.1"; else -> "$c canales"
}

internal fun bitrateLabel(b: Int): String? =
    if (b <= 0) null else if (b >= 1_000_000) String.format(Locale.US, "%.1f Mbps", b / 1_000_000f) else "${b / 1000} kbps"

internal fun resolutionLabel(h: Int) = when {
    h >= 2100 -> "4K"
    h >= 1400 -> "2K"
    h >= 1000 -> "FHD 1080p"
    h >= 700 -> "HD 720p"
    else -> "SD ${h}p"
}

internal fun speedLabel(s: Float) = if (abs(s - 1f) < 0.01f) "Normal" else "${s.toString().trimEnd('0').trimEnd('.')}x"

internal fun formatTime(ms: Long): String {
    val totalSec = (ms / 1000).coerceAtLeast(0)
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
}
