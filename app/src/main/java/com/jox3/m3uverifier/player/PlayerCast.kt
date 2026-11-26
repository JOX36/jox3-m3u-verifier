@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.view.View
import androidx.annotation.OptIn
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.mediarouter.media.MediaRouter

// Chromecast: selector de dispositivos propio y paso de la reproducción al TV y de vuelta.

// ═══ CHROMECAST ═══
internal fun PlayerActivity.initCast() {
    val ctx = castContext ?: return
    try {
        val cp = CastPlayer(ctx)
        cp.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (casting) updatePlayIcon() }
            override fun onPlaybackStateChanged(state: Int) { if (casting) { updatePlayIcon(); updateProgress() } }
            override fun onPlayerError(error: PlaybackException) {
                if (casting) showMessage("El Chromecast no pudo reproducirlo", "Algunos formatos (como MKV) o servidores no funcionan en Chromecast. Prueba con otro contenido.", "Ver en el teléfono", { castContext?.sessionManager?.endCurrentSession(true) })
            }
        })
        cp.setSessionAvailabilityListener(object : SessionAvailabilityListener {
            override fun onCastSessionAvailable() { startCasting() }
            override fun onCastSessionUnavailable() { stopCasting() }
        })
        castPlayer = cp
        if (cp.isCastSessionAvailable) ui.post { startCasting() }
    } catch (e: Throwable) { castPlayer = null }
}

internal fun PlayerActivity.openCastMenu() {
    val selector = try { castContext?.mergedSelector } catch (e: Exception) { null } ?: return
    if (castScanCb == null) {
        val cb = object : MediaRouter.Callback() {
            override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) { refreshCastMenu() }
            override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) { refreshCastMenu() }
            override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) { refreshCastMenu() }
        }
        try {
            MediaRouter.getInstance(this).addCallback(selector, cb, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN)
            castScanCb = cb
        } catch (e: Exception) { }
    }
    showCastPanel()
}

internal fun PlayerActivity.showCastPanel() {
    val selector = try { castContext?.mergedSelector } catch (e: Exception) { null } ?: return
    val router = MediaRouter.getInstance(this)
    val sel = router.selectedRoute
    val rows = mutableListOf<Row>()
    if (casting || (!sel.isDefault && sel.matchesSelector(selector))) {
        rows += Row("Transmitiendo a ${castDeviceName()}", current?.name, true, null)
        rows += Row("Dejar de transmitir", "Seguir viendo en este equipo") {
            closePanel(); castContext?.sessionManager?.endCurrentSession(true)
        }
    } else {
        val routes = router.routes.filter { !it.isDefault && it.isEnabled && it.matchesSelector(selector) }
        if (routes.isEmpty()) {
            rows += Row("Buscando dispositivos…", "El Chromecast o el TV deben estar en la misma red Wi-Fi", false, null)
        }
        routes.forEach { r ->
            rows += Row(r.name, r.description?.takeIf { it.isNotBlank() } ?: "Chromecast", false) {
                closePanel()
                showOsd("Conectando a ${r.name}…")
                try { router.selectRoute(r) } catch (e: Exception) { showOsd("No se pudo conectar") }
            }
        }
    }
    castMenuOpen = true
    openPanel("Transmitir a", rows, null)
}

internal fun PlayerActivity.refreshCastMenu() {
    if (castMenuOpen && panelRoot.visibility == View.VISIBLE) ui.post { if (castMenuOpen) showCastPanel() }
}

internal fun PlayerActivity.stopCastScan() {
    castScanCb?.let { try { MediaRouter.getInstance(this).removeCallback(it) } catch (e: Exception) { } }
    castScanCb = null
}

internal fun PlayerActivity.castDeviceName(): String =
    try { castContext?.sessionManager?.currentCastSession?.castDevice?.friendlyName } catch (e: Exception) { null } ?: "el TV"

internal fun PlayerActivity.castLoad(item: PlaylistItem, startMs: Long) {
    val cp = castPlayer ?: return
    cp.setMediaItem(CastSupport.item(item), startMs)
    cp.prepare()
    cp.playWhenReady = true
    showCastMessage()
}

internal fun PlayerActivity.startCasting() {
    val item = current ?: return
    if (casting) return
    val pos = if (item.isLive) C.TIME_UNSET else player.currentPosition
    casting = true
    player.pause()
    playerView.keepScreenOn = false
    castLoad(item, pos)
    updatePlayIcon()
    showControls()
}

internal fun PlayerActivity.stopCasting() {
    if (!casting) return
    val pos = castPlayer?.currentPosition ?: 0L
    casting = false
    hideMessage()
    if (isLive) player.seekToDefaultPosition() else if (pos > 0) player.seekTo(pos)
    player.prepare()
    player.play()
    showOsd("Reproduciendo en este equipo")
    updatePlayIcon()
}

internal fun PlayerActivity.showCastMessage() {
    showMessage("Transmitiendo a ${castDeviceName()}", current?.name ?: "", "Detener transmisión", { castContext?.sessionManager?.endCurrentSession(true) })
}
