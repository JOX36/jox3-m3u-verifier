@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import org.json.JSONArray
import org.json.JSONObject

// Lo que el reproductor guarda en el teléfono: reanudar películas/episodios, "Continuar viendo",
// canales recientes y el arranque seguro (apaga FFmpeg si el reproductor se cerró al abrir).

internal fun PlayerActivity.saveRecentLive(item: PlaylistItem) {
    try {
        val sp = getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE)
        val old = try { JSONArray(sp.getString(KEY_RECENT_LIVE, "[]")) } catch (e: Exception) { JSONArray() }
        val out = JSONArray().put(JSONObject().put("name", item.name).put("url", item.url).put("streamId", item.streamId)
            .put("poster", item.poster).put("epgId", item.epgId).put("ts", System.currentTimeMillis()))
        for (i in 0 until old.length()) {
            val o = old.optJSONObject(i) ?: continue
            if (o.optString("url") != item.url && out.length() < 20) out.put(o)
        }
        sp.edit().putString(KEY_RECENT_LIVE, out.toString()).apply()
    } catch (e: Exception) { }
}

// ═══ Arranque seguro ═══
// Si el reproductor se cierra solo mientras arranca (un fallo nativo no deja rastro), la próxima vez
// abre sin el decodificador de audio extra. Se marca antes de crear el reproductor y se borra
// cuando algo llega a reproducirse o se sale normalmente.

internal fun PlayerActivity.markStarting() {
    val sp = getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE)
    if (sp.getBoolean(KEY_STARTING, false)) sp.edit().putBoolean(PlayerActivity.KEY_FFMPEG_OFF, true).commit()
    sp.edit().putBoolean(KEY_STARTING, true).commit()
    startingMarked = true
}

internal fun PlayerActivity.startedOk() {
    if (!startingMarked) return
    startingMarked = false
    getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).edit().putBoolean(KEY_STARTING, false).apply()
}

internal fun PlayerActivity.ffmpegAllowed() = !getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).getBoolean(PlayerActivity.KEY_FFMPEG_OFF, false)

// ═══ Reanudar películas/episodios donde quedaste ═══
internal fun resumeKey(url: String) = "pos_" + url.hashCode()

internal fun PlayerActivity.savedPosition(url: String): Long =
    getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).getLong(resumeKey(url), 0L)

internal fun PlayerActivity.clearResumePosition(url: String) {
    getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).edit().remove(resumeKey(url)).apply()
}

internal fun PlayerActivity.saveResumePosition() {
    if (!playerReady) return
    val item = current ?: return
    if (item.isLive || item.url.isEmpty()) return
    val dur = player.duration
    val pos = player.currentPosition
    if (dur == C.TIME_UNSET || dur <= 0) return
    val sp = getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE)
    val prefs = sp.edit()
    val inProgress = pos > 30_000 && pos < dur - 60_000
    when {
        inProgress -> prefs.putLong(resumeKey(item.url), pos)
        pos >= dur - 60_000 -> prefs.remove(resumeKey(item.url))
    }
    // Lista "Continuar viendo" que muestra la app.
    if (inProgress || pos >= dur - 60_000) {
        val old = try { JSONArray(sp.getString(KEY_CONTINUE, "[]")) } catch (e: Exception) { JSONArray() }
        val updated = JSONArray()
        if (inProgress) {
            updated.put(
                JSONObject().put("name", item.name).put("url", item.url).put("streamId", item.streamId)
                    .put("poster", item.poster).put("pos", pos).put("dur", dur).put("ts", System.currentTimeMillis())
            )
        }
        for (i in 0 until old.length()) {
            val o = old.optJSONObject(i) ?: continue
            if (o.optString("url") == item.url) continue
            if (updated.length() >= MAX_CONTINUE) break
            updated.put(o)
        }
        prefs.putString(KEY_CONTINUE, updated.toString())
    }
    prefs.apply()
}
