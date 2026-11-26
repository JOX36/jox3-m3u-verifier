@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.content.Context
import android.content.Intent
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import com.jox3.m3uverifier.R
import java.io.File
import java.net.URL
import org.json.JSONObject

// Reproducción: datos que llegan de la interfaz, ExoPlayer, formato del canal en vivo,
// errores y reconexión, y navegación entre canales/episodios.

internal fun PlayerActivity.readPayload(src: Intent): String {
    // La lista viaja en un archivo: una categoría con miles de canales
    // supera el límite de ~1 MB de un Intent y tumbaba la app.
    src.getStringExtra(PlayerActivity.EXTRA_PAYLOAD_FILE)?.let { path ->
        try { return File(path).readText() } catch (e: Exception) { }
    }
    return src.getStringExtra(PlayerActivity.EXTRA_PAYLOAD) ?: "{}"
}

internal fun PlayerActivity.parsePayload(payload: String) {
    val list = mutableListOf<PlaylistItem>()
    try {
        val json = JSONObject(payload)
        apiUrl = json.optString("apiUrl", "")
        category = json.optString("category", "")
        currentIndex = json.optInt("startIndex", 0)
        val arr = json.optJSONArray("items")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                list.add(
                    PlaylistItem(
                        name = o.optString("name", "Sin nombre"),
                        url = o.optString("url", ""),
                        streamId = o.optString("streamId", ""),
                        isLive = o.optBoolean("isLive", false),
                        poster = o.optString("poster", ""),
                        epgId = o.optString("epgId", ""),
                        apiUrl = o.optString("apiUrl", "")
                    )
                )
            }
        }
    } catch (e: Exception) { }
    items = list
    if (currentIndex !in items.indices) currentIndex = 0
}

internal fun PlayerActivity.initPlayer() {
    // Mismo User-Agent que el verificador y seguir redirecciones http↔https:
    // sin esto, canales que salían ✅ en la lista daban "Sin señal".
    val httpFactory = DefaultHttpDataSource.Factory()
        .setUserAgent(USER_AGENT)
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(12_000)
        .setReadTimeoutMs(20_000)
    val dataSourceFactory = DefaultDataSource.Factory(this, httpFactory)

    // Flags típicos de IPTV: arranque más rápido en .ts que no empiezan en keyframe.
    val extractors = DefaultExtractorsFactory().setTsExtractorFlags(
        DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
            DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
    )

    val loadControl = DefaultLoadControl.Builder()
        .setBufferDurationsMs(20_000, 60_000, 1_500, 3_000)
        .build()

    player = ExoPlayer.Builder(this)
        .setRenderersFactory(SafeRenderersFactory(this, ffmpegAllowed()).setEnableDecoderFallback(true))
        .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory, extractors))
        .setLoadControl(loadControl)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(),
            true
        )
        .setHandleAudioBecomingNoisy(true)
        .setSeekBackIncrementMs(SEEK_STEP_MS)
        .setSeekForwardIncrementMs(SEEK_STEP_MS)
        .build()
    player.addListener(playerListener)
    playerView.player = player
}

internal fun PlayerActivity.loadCurrent(useSavedPosition: Boolean = true) {
    ui.removeCallbacks(retryRunnable)
    ui.removeCallbacks(countdownRunnable)
    countdownLeft = 0
    retryCount = 0
    hideMessage()

    val item = current
    if (item == null) {
        titleView.text = "Sin contenido"
        showMessage("Nada para reproducir", "La lista llegó vacía.", "Volver", { finish() })
        return
    }

    titleView.text = item.name
    subtitleView.text = buildString {
        if (category.isNotEmpty()) append(category)
        if (items.size > 1) {
            if (isNotEmpty()) append("  ·  ")
            append("${currentIndex + 1} de ${items.size}")
        }
    }
    subtitleView.visibility = if (subtitleView.text.isNullOrEmpty()) View.GONE else View.VISIBLE
    liveBadge.visibility = if (item.isLive) View.VISIBLE else View.GONE
    clockView.visibility = if (item.isLive) View.VISIBLE else View.GONE
    resBadge.visibility = View.GONE
    videoW = 0; videoH = 0
    configureControlsForItem(item)

    if (item.isLive) saveRecentLive(item)
    epgToken++
    epgNow = null; epgNext = null
    updateEpgViews()

    if (item.url.isEmpty()) {
        player.stop()
        showMessage("Sin URL", "Este elemento no tiene un enlace reproducible.", "Siguiente", { next() }, "Volver", { finish() })
        return
    }

    val start = if (!item.isLive && useSavedPosition) savedPosition(item.url) else 0L
    // En vivo se empieza con el formato que ya funcionó en este servidor.
    altStep = 0
    if (item.isLive) { val (u, m) = preferredLive(item.url); playingUrl = u; playingMime = m }
    else { playingUrl = item.url; playingMime = null }
    val mediaItem = buildMediaItem(playingUrl, item.name, playingMime)
    if (casting) {
        player.stop()
        castLoad(item, if (item.isLive) C.TIME_UNSET else start)
        if (item.isLive) fetchEpg(item)
        showControls()
        return
    }
    // Pistas elegidas para el canal anterior no aplican al nuevo.
    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverrides().build()
    player.setMediaItem(mediaItem, start)
    player.prepare()
    player.playWhenReady = true
    if (start > 0) showOsd("Reanudando en ${formatTime(start)}")

    if (item.isLive) fetchEpg(item)
    showControls()
}

// ═══ Formato del canal en vivo ═══
// Muchos servidores entregan HLS (.m3u8) aunque la dirección diga .ts, o la cuenta solo permite
// uno de los dos. Si el canal no abre por formato, se prueba el otro y se recuerda por servidor.
internal fun fmtKey(url: String) = "fmt_" + (try { java.net.URI(url).host } catch (e: Exception) { null } ?: "")

internal fun swapFormat(url: String): String? = when {
    url.endsWith(".ts", true) -> url.dropLast(3) + ".m3u8"
    url.endsWith(".m3u8", true) -> url.dropLast(5) + ".ts"
    else -> null
}

internal fun mimeFor(url: String): String? = when {
    url.endsWith(".m3u8", true) -> MimeTypes.APPLICATION_M3U8
    url.endsWith(".ts", true) -> MimeTypes.VIDEO_MP2T
    else -> null
}

/** Formato guardado para este servidor: "m3u8", "ts" o "ts-hls" (dirección .ts que en realidad entrega HLS). */
internal fun PlayerActivity.preferredLive(url: String): Pair<String, String?> {
    val pref = getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).getString(fmtKey(url), null) ?: return url to null
    val isTs = url.endsWith(".ts", true)
    return when {
        pref == "m3u8" && isTs -> (url.dropLast(3) + ".m3u8") to MimeTypes.APPLICATION_M3U8
        pref == "ts-hls" && isTs -> url to MimeTypes.APPLICATION_M3U8
        pref == "ts" && url.endsWith(".m3u8", true) -> (url.dropLast(5) + ".ts") to MimeTypes.VIDEO_MP2T
        else -> url to null
    }
}

internal fun PlayerActivity.rememberLiveFormat() {
    if (!isLive || playingUrl.isEmpty() || altStep == 0) return
    val fmt = when {
        playingUrl.endsWith(".m3u8", true) -> "m3u8"
        playingUrl.endsWith(".ts", true) && playingMime == MimeTypes.APPLICATION_M3U8 -> "ts-hls"
        playingUrl.endsWith(".ts", true) -> "ts"
        else -> return
    }
    getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).edit().putString(fmtKey(playingUrl), fmt).apply()
}

internal fun buildMediaItem(url: String, title: String, mime: String? = null): MediaItem {
    val b = MediaItem.Builder().setUri(url).setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
    val m = mime ?: if (url.endsWith(".m3u8", true)) MimeTypes.APPLICATION_M3U8 else null
    if (m != null) b.setMimeType(m)
    return b.build()
}

/**
 * true si se lanzó otro intento. Orden: (1) la otra extensión (.ts ↔ .m3u8);
 * (2) la dirección original leída a la fuerza como HLS (o TS): pasa cuando el servidor
 * redirige el .ts a una lista .m3u8 de otra fuente, típico en canales "reenviados".
 */
internal fun PlayerActivity.tryOtherFormat(error: PlaybackException): Boolean {
    val item = current ?: return false
    if (!isLive || casting || altStep >= 2) return false
    val http = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
    val formatProblem = error.errorCode in 3000..3999 || http == 403 || http == 404 || http == 406 || http == 415
    if (!formatProblem) return false
    val orig = item.url
    val next: Pair<String, String?> = if (altStep == 0) {
        val alt = swapFormat(playingUrl) ?: return false
        alt to mimeFor(alt)
    } else {
        orig to (if (orig.endsWith(".ts", true)) MimeTypes.APPLICATION_M3U8 else MimeTypes.VIDEO_MP2T)
    }
    altStep++
    playingUrl = next.first; playingMime = next.second
    showMessage("Probando otro formato… ($altStep/2)", "El canal no abrió a la primera; intentando de otra forma.")
    player.setMediaItem(buildMediaItem(playingUrl, item.name, playingMime))
    player.prepare()
    player.playWhenReady = true
    return true
}

internal fun PlayerActivity.configureControlsForItem(item: PlaylistItem) {
    val multi = items.size > 1
    btnPrev.visibility = if (multi) View.VISIBLE else View.GONE
    btnNext.visibility = if (multi) View.VISIBLE else View.GONE
    btnRewind.visibility = if (item.isLive) View.GONE else View.VISIBLE
    btnForward.visibility = if (item.isLive) View.GONE else View.VISIBLE
    seekRow.visibility = if (item.isLive) View.GONE else View.VISIBLE
    epgBox.visibility = View.GONE
    updateClock()
}

internal fun PlayerActivity.handleError(error: PlaybackException) {
    loading.visibility = View.GONE
    if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
        player.seekToDefaultPosition()
        player.prepare()
        return
    }
    if (tryOtherFormat(error)) return
    val detail = describeError(error)
    // Un 4xx (403, 404…) es una respuesta del servidor, no un corte: reintentar
    // no sirve y puede empeorar un bloqueo de la IP. Solo se reintentan cortes y 5xx.
    val http = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
    val retryable = error.errorCode in 2000..2999 && (http == null || http >= 500)
    if (retryable && retryCount < MAX_RETRIES) {
        retryCount++
        showMessage("Reconectando… ($retryCount/$MAX_RETRIES)", detail)
        ui.removeCallbacks(retryRunnable)
        ui.postDelayed(retryRunnable, 1500L * retryCount)
    } else {
        val hasNext = items.size > 1
        showMessage(
            "Sin señal", detail,
            "Reintentar", { manualRetry() },
            if (hasNext) (if (isLive) "Siguiente canal" else "Siguiente") else "Volver",
            { if (hasNext) next() else finish() }
        )
        showControls()
    }
}

internal fun PlayerActivity.describeError(error: PlaybackException): String {
    val http = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
    return when {
        http == 401 || http == 403 ->
            "El servidor rechazó la conexión (HTTP $http). Puede que la cuenta tenga todas sus conexiones en uso o esté vencida."
        http == 404 -> "El servidor respondió HTTP 404: no encuentra este contenido o está rechazando la conexión (bloqueo temporal o conexiones de la cuenta en uso)."
        http != null -> "El servidor respondió con un error (HTTP $http)."
        error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ->
            "No se pudo conectar con el servidor. Revisa tu internet."
        error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
            "El servidor tardó demasiado en responder."
        error.errorCode in 3000..3999 && isLive ->
            "El canal no está enviando video ahora (puede estar caído en el servidor)." + if (altTried) " Se probó en TS y en HLS." else ""
        error.errorCode in 3000..3999 -> "El formato del archivo no es compatible."
        error.errorCode in 4000..4999 -> "Este dispositivo no puede decodificar el video."
        else -> "Error de reproducción (${error.errorCodeName})."
    }
}

/** Recargar: en vivo salta a lo que están pasando ahora; en películas sigue en el mismo punto. */
internal fun PlayerActivity.refreshStream(silent: Boolean = false) {
    hideMessage(); retryCount = 0
    if (casting) { current?.let { castLoad(it, if (isLive) C.TIME_UNSET else ap.currentPosition) }; return }
    val pos = player.currentPosition
    if (player.currentMediaItem == null) { loadCurrent(); return }
    if (isLive) player.seekToDefaultPosition() else player.seekTo(pos)
    player.prepare()
    player.playWhenReady = true
    if (!silent) showOsd(if (isLive) "Recargando en vivo" else "Recargando")
    current?.let { if (it.isLive) fetchEpg(it) }
}

internal fun PlayerActivity.manualRetry() {
    hideMessage()
    retryCount = 0
    if (player.playerError != null) retryRunnable.run() else loadCurrent()
}

internal fun PlayerActivity.onEnded() {
    val item = current ?: return
    if (item.isLive) {
        // Un canal en vivo "termina" cuando el servidor corta: reconectar.
        if (retryCount < MAX_RETRIES) {
            retryCount++
            showMessage("Reconectando… ($retryCount/$MAX_RETRIES)", "El servidor cortó la transmisión.")
            ui.removeCallbacks(retryRunnable)
            ui.postDelayed(retryRunnable, 1000L * retryCount)
        } else {
            showMessage("Transmisión finalizada", "El canal dejó de emitir.", "Reintentar", { manualRetry() }, "Volver", { finish() })
        }
        return
    }
    clearResumePosition(item.url)
    if (currentIndex < items.size - 1) {
        countdownLeft = NEXT_EPISODE_SECONDS
        showMessage(
            "Siguiente",
            "${items[currentIndex + 1].name}\nEmpieza en $countdownLeft s",
            "Reproducir ahora", { ui.removeCallbacks(countdownRunnable); countdownLeft = 0; hideMessage(); next() },
            "Cancelar", { ui.removeCallbacks(countdownRunnable); countdownLeft = 0; hideMessage(); showControls() }
        )
        ui.removeCallbacks(countdownRunnable)
        ui.postDelayed(countdownRunnable, 1000)
    } else {
        showMessage("Fin", item.name, "Ver de nuevo", { hideMessage(); player.seekTo(0); player.play() }, "Volver", { finish() })
        showControls()
    }
}

internal fun PlayerActivity.togglePlay() {
    val p = ap
    if (p.playbackState == Player.STATE_ENDED) { p.seekTo(0); p.play(); return }
    if (!casting && player.playerError != null) { manualRetry(); return }
    if (p.playWhenReady) p.pause() else p.play()
    if (casting) updatePlayIcon()
}

internal fun PlayerActivity.updatePlayIcon() {
    val p = ap
    val showPause = p.playWhenReady && p.playbackState != Player.STATE_ENDED
    btnPlay.setImageResource(if (showPause) R.drawable.ic_pause else R.drawable.ic_play)
    btnPlay.contentDescription = if (showPause) "Pausar" else "Reproducir"
}

internal fun PlayerActivity.seekBy(deltaMs: Long) {
    if (isLive) return
    val p = ap
    val dur = p.duration
    var target = p.currentPosition + deltaMs
    if (dur != C.TIME_UNSET && dur > 0) target = target.coerceAtMost((dur - 1000).coerceAtLeast(0))
    p.seekTo(target.coerceAtLeast(0))
    showOsd(if (deltaMs > 0) "+${deltaMs / 1000} s" else "−${-deltaMs / 1000} s")
    updateProgress()
}

internal fun PlayerActivity.prev() {
    if (items.size < 2) return
    saveResumePosition()
    currentIndex = if (currentIndex - 1 < 0) items.size - 1 else currentIndex - 1
    loadCurrent()
}

internal fun PlayerActivity.next() {
    if (items.size < 2) return
    saveResumePosition()
    currentIndex = (currentIndex + 1) % items.size
    loadCurrent()
}

internal fun PlayerActivity.playIndex(index: Int) {
    if (index !in items.indices) return
    saveResumePosition()
    currentIndex = index
    loadCurrent()
}
