@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.View
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import com.jox3.m3uverifier.ExternalEpg
import java.net.URL
import java.util.Date
import kotlin.math.abs
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject

// Panel lateral: lista de canales con la guía, ajustes, pistas, velocidad, apagado automático.

// ═══════════════════════════════════════════════════════════════════
// PANEL LATERAL: lista de canales y ajustes
// ═══════════════════════════════════════════════════════════════════

internal fun PlayerActivity.openPanel(title: String, rows: List<Row>, parent: (() -> Unit)?, selection: Int = -1) {
    channelListOpen = false
    panelTitle.text = title
    panelParent = parent
    panelAdapter.rows = rows
    val width = (root.width * 0.55f).toInt().coerceIn(dp(280), dp(400))
    (panel.layoutParams as FrameLayout.LayoutParams).width = if (root.width > 0) width else dp(360)
    panel.requestLayout()
    if (panelRoot.visibility != View.VISIBLE) {
        hideControls()
        panelRoot.visibility = View.VISIBLE
        panel.translationX = dp(400).toFloat()
        panel.animate().translationX(0f).setDuration(200).start()
    }
    panelList.setSelection(if (selection > 2) selection - 2 else 0)
    if (tv) ui.post { panelList.requestFocus(); panelList.setSelection(if (selection >= 0) selection else 0) }
}

internal fun PlayerActivity.closePanel() {
    if (castMenuOpen) { castMenuOpen = false; stopCastScan() }
    channelListOpen = false; listEpgQueue.clear()
    if (panelRoot.visibility != View.VISIBLE) return
    panel.animate().translationX(dp(400).toFloat()).setDuration(180).withEndAction {
        panelRoot.visibility = View.GONE
    }.start()
    panelParent = null
}

internal fun PlayerActivity.panelGoBack() {
    val parent = panelParent
    if (parent != null) parent() else closePanel()
}

// ═══ Lista de canales con lo que están pasando ═══
// Debajo de cada canal: el programa actual. Sale primero de lo ya conocido y de la guía de internet
// (local, instantáneo); para los canales visibles se le pregunta al servidor de a uno, con pausa.
internal fun PlayerActivity.listNow(it: PlaylistItem): EpgEntry? {
    val now = System.currentTimeMillis() / 1000
    if (it === current) epgNow?.let { e -> if (e.stopSec > now) return e }
    listEpg[it.streamId]?.let { e -> if (e.stopSec > now) return e }
    val p = try { ExternalEpg.programs(this, it.name, it.epgId, now, now + 60).firstOrNull() } catch (e: Exception) { null }
    return p?.let { EpgEntry(it.title, it.start, it.stop) }
}

internal fun PlayerActivity.channelRows(): List<Row> {
    val fmt = android.text.format.DateFormat.getTimeFormat(this)
    return items.mapIndexed { i, it ->
        val sub = if (it.isLive) listNow(it)?.let { e -> "Ahora: ${e.title}" + if (e.startSec > 0) "  ·  ${fmt.format(Date(e.startSec * 1000))}" else "" } else null
        Row("${i + 1}.  ${it.name}", sub, i == currentIndex) { closePanel(); if (i != currentIndex) playIndex(i) }
    }
}

internal fun PlayerActivity.openChannelList() {
    if (items.isEmpty()) return
    val title = when {
        isLive -> "Canales"
        category.equals("Series", ignoreCase = true) -> "Episodios"
        else -> category.ifEmpty { "Lista" }
    }
    openPanel("$title (${items.size})", channelRows(), null, currentIndex)
    channelListOpen = true
    if (isLive) askListEpg(currentIndex - 6, currentIndex + 14)
}

/** Pide al servidor la guía de los canales entre dos posiciones de la lista (solo los que faltan). */
internal fun PlayerActivity.askListEpg(from: Int, to: Int) {
    if (!channelListOpen) return
    for (i in from.coerceAtLeast(0)..to.coerceAtMost(items.size - 1)) {
        val it = items[i]
        if (!it.isLive || it.streamId.isEmpty() || (it.apiUrl.isEmpty() && apiUrl.isEmpty()) || listEpgAsked.contains(it.streamId) || listNow(it) != null) continue
        listEpgAsked.add(it.streamId)
        listEpgQueue.addLast(it)
    }
    pumpListEpg()
}

internal fun PlayerActivity.pumpListEpg() {
    if (listEpgBusy || !channelListOpen || netExecutor.isShutdown) return
    val it = listEpgQueue.removeFirstOrNull() ?: return
    listEpgBusy = true
    try {
        netExecutor.execute {
            val now = System.currentTimeMillis() / 1000
            val entry = serverEpg(it, 2).firstOrNull { e -> e.stopSec > now }
            runOnUiThread {
                listEpgBusy = false
                if (isDestroyed) return@runOnUiThread
                entry?.let { e -> listEpg[it.streamId] = e; if (channelListOpen && panelRoot.visibility == View.VISIBLE) panelAdapter.rows = channelRows() }
                ui.postDelayed({ pumpListEpg() }, 700)
            }
        }
    } catch (e: Exception) { listEpgBusy = false }
}

internal fun PlayerActivity.openSettings() {
    val rows = mutableListOf<Row>()
    rows += Row("Audio", currentTrackLabel(C.TRACK_TYPE_AUDIO) ?: "Predeterminado") { openTrackMenu(C.TRACK_TYPE_AUDIO) }
    rows += Row("Subtítulos", currentTrackLabel(C.TRACK_TYPE_TEXT) ?: "Desactivados") { openTrackMenu(C.TRACK_TYPE_TEXT) }
    if (countTracks(C.TRACK_TYPE_VIDEO) > 1) {
        rows += Row("Calidad", if (hasOverride(C.TRACK_TYPE_VIDEO)) currentTrackLabel(C.TRACK_TYPE_VIDEO) else "Automática") { openTrackMenu(C.TRACK_TYPE_VIDEO) }
    }
    if (!isLive) {
        rows += Row("Velocidad", speedLabel(player.playbackParameters.speed)) { openSpeedMenu() }
    }
    rows += Row("Ajuste de imagen", resizeLabel(resizeMode)) { openResizeMenu() }
    rows += Row("Apagado automático", sleepLabel()) { openSleepMenu() }
    rows += Row("Recargar stream", "Vuelve a conectar con el servidor") { closePanel(); loadCurrent() }
    rows += Row("Copiar URL del stream", null) { copyUrl(); closePanel() }
    rows += Row("Información técnica", null) { openStreamInfo() }
    openPanel("Ajustes", rows, null)
}

internal fun PlayerActivity.openTrackMenu(type: Int) {
    val rows = mutableListOf<Row>()
    val params = player.trackSelectionParameters
    if (type == C.TRACK_TYPE_TEXT) {
        val off = params.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT) || currentTrackLabel(C.TRACK_TYPE_TEXT) == null
        rows += Row("Desactivados", selected = off) {
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .build()
            openSettings()
        }
    }
    if (type == C.TRACK_TYPE_VIDEO) {
        rows += Row("Automática", "Se adapta a tu conexión", selected = !hasOverride(C.TRACK_TYPE_VIDEO)) {
            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                .build()
            openSettings()
        }
    }
    var n = 0
    for (group in player.currentTracks.groups) {
        if (group.type != type) continue
        for (i in 0 until group.length) {
            if (!group.isTrackSupported(i)) continue
            n++
            val format = group.getTrackFormat(i)
            val selected = group.isTrackSelected(i) &&
                !(type == C.TRACK_TYPE_TEXT && params.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)) &&
                !(type == C.TRACK_TYPE_VIDEO && !hasOverride(C.TRACK_TYPE_VIDEO))
            rows += Row(trackLabel(format, type, n), trackDetail(format, type), selected) {
                player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(type, false)
                    .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, i))
                    .build()
                openSettings()
            }
        }
    }
    if (n == 0) rows += Row("No hay pistas disponibles", "Este stream no trae opciones de este tipo")
    val title = when (type) {
        C.TRACK_TYPE_AUDIO -> "Audio"
        C.TRACK_TYPE_TEXT -> "Subtítulos"
        else -> "Calidad"
    }
    openPanel(title, rows, { openSettings() })
}

internal fun PlayerActivity.openSpeedMenu() {
    val speeds = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
    val currentSpeed = player.playbackParameters.speed
    val rows = speeds.map { s ->
        Row(speedLabel(s), selected = abs(s - currentSpeed) < 0.01f) { player.setPlaybackSpeed(s); openSettings() }
    }
    openPanel("Velocidad", rows, { openSettings() })
}

internal fun PlayerActivity.openResizeMenu() {
    val modes = listOf(
        RESIZE_SMART to "Borde a borde sin cortar logos ni textos (recomendado)",
        AspectRatioFrameLayout.RESIZE_MODE_FIT to "Se ve el video entero, puede dejar franjas",
        AspectRatioFrameLayout.RESIZE_MODE_FILL to "Llena sin recortar, deforma la imagen",
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM to "Llena sin deformar, recorta arriba y abajo"
    )
    val rows = modes.map { (mode, detail) ->
        Row(resizeLabel(mode), detail, mode == resizeMode) { setResizeMode(mode); openSettings() }
    } + Row("Consejo", "Pellizca la pantalla para alternar rápido")
    openPanel("Ajuste de imagen", rows, { openSettings() })
}

internal fun PlayerActivity.openSleepMenu() {
    val options = listOf(0, 15, 30, 45, 60, 90, 120)
    val rows = options.map { min ->
        val label = if (min == 0) "Desactivado" else "$min minutos"
        val selected = if (min == 0) sleepAtMs == 0L else false
        Row(label, selected = selected) {
            sleepAtMs = if (min == 0) 0L else System.currentTimeMillis() + min * 60_000L
            if (min > 0) showOsd("Se pausará en $min min")
            openSettings()
        }
    }
    openPanel("Apagado automático", rows, { openSettings() })
}

internal fun PlayerActivity.openStreamInfo() {
    val rows = mutableListOf<Row>()
    val v = player.videoFormat
    val a = player.audioFormat
    if (v != null) {
        rows += Row("Video", listOfNotNull(
            if (v.width > 0) "${v.width}×${v.height}" else null,
            codecName(v.sampleMimeType),
            if (v.frameRate > 0) "${v.frameRate.roundToInt()} fps" else null,
            bitrateLabel(v.bitrate)
        ).joinToString("  ·  "))
    }
    if (a != null) {
        rows += Row("Audio", listOfNotNull(
            codecName(a.sampleMimeType),
            if (a.channelCount > 0) channelsLabel(a.channelCount) else null,
            if (a.sampleRate > 0) "${a.sampleRate / 1000} kHz" else null,
            bitrateLabel(a.bitrate)
        ).joinToString("  ·  "))
    }
    rows += Row("Búfer", "${player.totalBufferedDuration / 1000} s cargados")
    current?.url?.let { url ->
        val host = try { URL(url).host + (URL(url).port.takeIf { it > 0 }?.let { ":$it" } ?: "") } catch (e: Exception) { "" }
        val ext = url.substringAfterLast('.', "").substringBefore('?').lowercase()
        rows += Row("Servidor", host.ifEmpty { "Desconocido" })
        if (ext.isNotEmpty() && ext.length <= 5) rows += Row("Formato", ext.uppercase())
    }
    if (v == null && a == null) rows.add(0, Row("Sin datos aún", "Espera a que el stream empiece a reproducirse"))
    openPanel("Información técnica", rows, { openSettings() })
}

internal fun PlayerActivity.sleepLabel(): String {
    if (sleepAtMs == 0L) return "Desactivado"
    val left = ((sleepAtMs - System.currentTimeMillis()) / 60_000L).coerceAtLeast(0) + 1
    return "En $left min"
}

internal fun PlayerActivity.onSleepTimer() {
    sleepAtMs = 0L
    player.pause()
    showMessage("Apagado automático", "La reproducción se pausó.", "Seguir viendo", { hideMessage(); player.play() }, "Salir", { finish() })
}

// ═══ Acciones ═══
internal fun PlayerActivity.copyUrl() {
    val item = current ?: return
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("stream_url", item.url))
    showOsd("URL copiada")
}

internal fun PlayerActivity.addToList() {
    val item = current ?: return
    val prefs = getSharedPreferences(PREFS_BRIDGE, Context.MODE_PRIVATE)
    val pending = try { JSONArray(prefs.getString(KEY_PENDING_ADDS, "[]")) } catch (e: Exception) { JSONArray() }
    pending.put(JSONObject().put("name", item.name).put("url", item.url).put("category", category))
    prefs.edit().putString(KEY_PENDING_ADDS, pending.toString()).apply()
    showOsd("Añadido a Mi Lista")
}
