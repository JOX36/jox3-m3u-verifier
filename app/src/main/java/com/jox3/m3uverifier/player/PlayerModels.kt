package com.jox3.m3uverifier.player

// Datos y constantes que comparten todas las partes del reproductor.

/** Un item reproducible dentro del playlist que manda el WebView. */
data class PlaylistItem(
    val name: String,
    val url: String,
    val streamId: String,
    val isLive: Boolean,
    val poster: String = "",
    val epgId: String = ""
)

/** Un programa de la guía (horas en segundos Unix). */
internal data class EpgEntry(val title: String, val startSec: Long, val stopSec: Long)

/** Una fila del panel lateral (lista de canales, ajustes…). Sin acción = solo informativa. */
internal data class Row(
    val title: String,
    val subtitle: String? = null,
    val selected: Boolean = false,
    val action: (() -> Unit)? = null
)

/** Qué está haciendo el dedo al deslizar sobre el video. */
internal enum class ScrollMode { NONE, VOLUME, BRIGHTNESS, SEEK, ZAP, IGNORED }

// ═══ Comportamiento ═══
internal const val USER_AGENT = "VLC/3.0.0"
internal const val AUTO_HIDE_MS = 4000L
internal const val MAX_RETRIES = 4
internal const val SEEK_STEP_MS = 10_000L
internal const val NEXT_EPISODE_SECONDS = 8

/**
 * Pantalla completa inteligente: llena la pantalla recortando como máximo
 * ~3 % por lado (la "zona segura" donde los canales nunca ponen logos ni
 * textos) y completa el resto estirando un poco la imagen.
 */
internal const val RESIZE_SMART = 100
internal const val SMART_MAX_ZOOM = 1.06f

// ═══ Lo que se guarda en el teléfono ═══
internal const val PREFS_PLAYER = "jox3_player"
internal const val KEY_STARTING = "player_starting"
internal const val KEY_RESIZE = "resize_mode_v2"
internal const val PREFS_BRIDGE = "jox3_bridge"
internal const val KEY_PENDING_ADDS = "pending_adds"
internal const val KEY_CONTINUE = "continue_watching"
internal const val KEY_RECENT_LIVE = "recent_live"
internal const val MAX_CONTINUE = 40

// ═══ Botones de la ventana flotante ═══
internal const val ACTION_PIP = "com.jox3.m3uverifier.PIP_CONTROL"
internal const val EXTRA_PIP = "control"
internal const val PIP_PLAY_PAUSE = 1
internal const val PIP_PREV = 2
internal const val PIP_NEXT = 3
