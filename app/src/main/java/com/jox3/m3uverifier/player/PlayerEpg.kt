@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.util.Base64
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.jox3.m3uverifier.ExternalEpg
import java.net.HttpURLConnection
import java.net.URL
import java.util.Date
import org.json.JSONObject

// Guía de programación (EPG): ahora/después del canal y guía de internet si el servidor no tiene.

// ═══════════════════════════════════════════════════════════════════
// EPG
// ═══════════════════════════════════════════════════════════════════

/** Guía corta del servidor para un canal (vacía si no tiene o falla). Se llama fuera del hilo principal. */
internal fun PlayerActivity.serverEpg(streamId: String, limit: Int): List<EpgEntry> {
    if (streamId.isEmpty() || apiUrl.isEmpty()) return emptyList()
    val out = mutableListOf<EpgEntry>()
    try {
        val conn = URL("$apiUrl&action=get_short_epg&stream_id=$streamId&limit=$limit").openConnection() as HttpURLConnection
        conn.connectTimeout = 6000
        conn.readTimeout = 6000
        conn.setRequestProperty("User-Agent", USER_AGENT)
        val text = try { conn.inputStream.bufferedReader().use { it.readText() } } finally { conn.disconnect() }
        val listings = JSONObject(text).optJSONArray("epg_listings") ?: return out
        for (i in 0 until listings.length()) {
            val o = listings.optJSONObject(i) ?: continue
            val title = decodeMaybeBase64(o.optString("title", "")).trim()
            val start = o.optString("start_timestamp", "0").toLongOrNull() ?: 0L
            val stop = o.optString("stop_timestamp", "0").toLongOrNull() ?: 0L
            if (title.isNotEmpty()) out.add(EpgEntry(title, start, stop))
        }
    } catch (e: Exception) { /* sin guía del servidor */ }
    return out
}

internal fun PlayerActivity.fetchEpg(item: PlaylistItem) {
    if (netExecutor.isShutdown) return
    val token = ++epgToken
    try {
        netExecutor.execute {
            val result = serverEpg(item.streamId, 2).toMutableList()
            // El servidor no tiene guía para este canal: se busca en la guía de internet.
            if (result.isEmpty() && item.isLive) {
                val now = System.currentTimeMillis() / 1000
                ExternalEpg.programs(this, item.name, item.epgId, now - 3600, now + 12 * 3600)
                    .forEach { result.add(EpgEntry(it.title, it.start, it.stop)) }
            }
            runOnUiThread {
                // Si el usuario ya cambió de canal, esta respuesta es vieja: se descarta.
                if (token != epgToken || isDestroyed) return@runOnUiThread
                val now = System.currentTimeMillis() / 1000
                val sorted = result.sortedBy { it.startSec }
                epgNow = sorted.firstOrNull { it.stopSec > now } ?: sorted.firstOrNull()
                epgNext = sorted.firstOrNull { it.startSec >= (epgNow?.stopSec ?: Long.MAX_VALUE) }
                updateEpgViews()
            }
        }
    } catch (e: Exception) { }
}

internal fun PlayerActivity.updateEpgViews() {
    val nowEntry = epgNow
    if (!isLive || nowEntry == null) { epgBox.visibility = View.GONE; return }
    epgBox.visibility = View.VISIBLE
    val fmt = android.text.format.DateFormat.getTimeFormat(this)
    fun t(sec: Long) = if (sec > 0) fmt.format(Date(sec * 1000)) else ""
    epgNowView.text = "AHORA  ${t(nowEntry.startSec)}–${t(nowEntry.stopSec)}   ${nowEntry.title}"
    val now = System.currentTimeMillis() / 1000
    val span = nowEntry.stopSec - nowEntry.startSec
    if (span > 0) {
        epgProgress.visibility = View.VISIBLE
        epgProgress.progress = (((now - nowEntry.startSec).toFloat() / span) * 1000).toInt().coerceIn(0, 1000)
    } else epgProgress.visibility = View.GONE
    val nextEntry = epgNext
    if (nextEntry != null) {
        epgNextView.visibility = View.VISIBLE
        epgNextView.text = "DESPUÉS  ${t(nextEntry.startSec)}   ${nextEntry.title}"
    } else epgNextView.visibility = View.GONE
}

internal fun decodeMaybeBase64(s: String): String {
    if (s.isEmpty()) return s
    return try {
        val decoded = String(Base64.decode(s, Base64.DEFAULT), Charsets.UTF_8)
        val readable = decoded.isNotBlank() && decoded.none { it.code in 0..8 || it == '�' }
        if (readable) decoded else s
    } catch (e: Exception) { s }
}
