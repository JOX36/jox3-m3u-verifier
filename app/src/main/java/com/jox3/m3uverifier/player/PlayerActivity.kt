package com.jox3.m3uverifier.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.cast.CastPlayer
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.framework.CastContext
import com.jox3.m3uverifier.ExternalEpg
import com.jox3.m3uverifier.isTvDevice
import org.json.JSONArray
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Reproductor nativo (ExoPlayer/Media3) a pantalla completa real:
 *  - Borde a borde, también sobre el notch/cámara (sin franja negra lateral).
 *  - User-Agent tipo VLC y redirecciones http↔https, como el verificador.
 *  - Reconexión automática, indicador de carga y mensajes de error claros.
 *  - Barra de progreso, ±10 s, reanudar donde quedaste y siguiente episodio automático.
 *  - Gestos: doble toque para adelantar/retroceder, deslizar para volumen/brillo,
 *    deslizar horizontal para buscar (VOD) o cambiar de canal (en vivo),
 *    pellizcar para alternar "llenar pantalla" / "ver completo".
 *  - Lista de canales/episodios, pistas de audio, subtítulos, calidad, velocidad,
 *    apagado automático, bloqueo de pantalla, EPG ahora/después y PiP con controles.
 *
 * Esta clase guarda el estado y el ciclo de vida. Cada función vive en su archivo:
 *  - PlayerPlayback.kt  reproducción, formatos, errores, cambio de canal
 *  - PlayerStorage.kt   reanudar, continuar viendo, recientes, arranque seguro
 *  - PlayerUi.kt        interfaz, controles y mensajes
 *  - PlayerInput.kt     gestos, ajuste de imagen, teclas y Atrás
 *  - PlayerPanels.kt    lista de canales y ajustes
 *  - PlayerTracks.kt    pistas y textos de formatos
 *  - PlayerEpg.kt       guía de programación
 *  - PlayerPip.kt       ventana flotante
 *  - PlayerCast.kt      Chromecast
 *  - PlayerWidgets.kt   botones y piezas de interfaz
 */
@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PAYLOAD_FILE = "payloadFile"
        const val EXTRA_PAYLOAD = "payload"
        const val KEY_FFMPEG_OFF = "ffmpeg_off"

        /** Películas/episodios empezados y no terminados, el más reciente primero. */
        fun continueWatching(ctx: Context): String =
            ctx.getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).getString(KEY_CONTINUE, "[]") ?: "[]"

        /** Últimos canales en vivo abiertos (el más reciente primero), también los cambiados dentro del reproductor. */
        fun recentLive(ctx: Context): String =
            ctx.getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).getString(KEY_RECENT_LIVE, "[]") ?: "[]"

        /**
         * Items que el usuario añadió a "Mi Lista" desde el reproductor y que el
         * WebView aún no ha recibido. Se guardan en disco (no en un callback
         * estático) para no perderlos aunque Android cierre la app por memoria.
         */
        fun takePendingAdds(ctx: Context): JSONArray {
            val prefs = ctx.getSharedPreferences(PREFS_BRIDGE, Context.MODE_PRIVATE)
            val raw = prefs.getString(KEY_PENDING_ADDS, null) ?: return JSONArray()
            prefs.edit().remove(KEY_PENDING_ADDS).apply()
            return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        }
    }

    // ═══ Colores de la marca ═══
    internal val accent = Color.parseColor("#00d4ff")
    internal val muted = Color.parseColor("#8fb3cc")
    internal val panelBg = Color.parseColor("#B3081626")
    internal val buttonBg = Color.parseColor("#5A0b1e30")
    internal val liveRed = Color.parseColor("#ff3355")

    // ═══ Estado ═══
    internal lateinit var player: ExoPlayer
    internal val playerReady: Boolean get() = ::player.isInitialized
    internal var items: List<PlaylistItem> = emptyList()
    internal var currentIndex = 0
    internal var apiUrl = ""
    internal var category = ""
    internal val current: PlaylistItem? get() = items.getOrNull(currentIndex)
    internal val isLive: Boolean get() = current?.isLive == true

    internal var retryCount = 0
    internal var controlsVisible = false
    internal var locked = false
    internal var userSeeking = false
    internal var resumeOnStart = false
    internal var videoW = 0
    internal var videoH = 0
    internal var resizeMode = RESIZE_SMART
    internal var videoAspect = 0f
    internal var contentFrame: AspectRatioFrameLayout? = null
    internal var sleepAtMs = 0L
    internal var countdownLeft = 0
    internal var epgToken = 0
    internal var epgNow: EpgEntry? = null
    internal var epgNext: EpgEntry? = null
    internal var pipReceiverRegistered = false
    internal var startingMarked = false
    internal var stoppedAt = 0L
    // En vivo: dirección que se está probando y si ya se intentó con el otro formato (.ts ↔ .m3u8).
    internal var playingUrl = ""
    internal var playingMime: String? = null
    internal var altStep = 0           // 0 = como viene, 1 = otra extensión, 2 = misma dirección leída como HLS/TS
    internal val altTried get() = altStep > 0

    // Chromecast
    internal var castContext: CastContext? = null
    internal var castPlayer: CastPlayer? = null
    internal var casting = false
    internal var castScanCb: MediaRouter.Callback? = null
    internal var castMenuOpen = false
    /** El reproductor que manda en este momento: el del teléfono o el del Chromecast. */
    internal val ap: Player get() = if (casting) castPlayer ?: player else player

    // Misma letra que el resto de la app (Inter), también en el reproductor.
    internal val fontRegular: Typeface by lazy { loadFont("inter-Regular.otf", Typeface.NORMAL) }
    internal val fontBold: Typeface by lazy { loadFont("inter-Bold.otf", Typeface.BOLD) }
    /** TV box / Android TV: se maneja con control remoto. */
    internal val tv by lazy { isTvDevice(this) }

    internal val ui = Handler(Looper.getMainLooper())
    internal var netExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    internal lateinit var audioManager: AudioManager

    // ═══ Vistas ═══
    internal lateinit var root: FrameLayout
    internal lateinit var playerView: PlayerView
    internal lateinit var gestureLayer: View
    internal lateinit var loading: ProgressBar
    internal lateinit var controls: FrameLayout
    internal lateinit var topBar: LinearLayout
    internal lateinit var bottomBar: LinearLayout
    internal lateinit var centerRow: LinearLayout
    internal lateinit var titleView: TextView
    internal lateinit var subtitleView: TextView
    internal lateinit var resBadge: TextView
    internal lateinit var liveBadge: TextView
    internal lateinit var clockView: TextView
    internal lateinit var epgBox: LinearLayout
    internal lateinit var epgNowView: TextView
    internal lateinit var epgProgress: ProgressBar
    internal lateinit var epgNextView: TextView
    internal lateinit var btnPrev: ImageView
    internal lateinit var btnRewind: ImageView
    internal lateinit var btnPlay: ImageView
    internal lateinit var btnForward: ImageView
    internal lateinit var btnNext: ImageView
    internal lateinit var btnPip: ImageView
    internal lateinit var seekRow: LinearLayout
    internal lateinit var seekBar: SeekBar
    internal lateinit var posView: TextView
    internal lateinit var durView: TextView
    internal lateinit var osdView: TextView
    internal lateinit var indicator: LinearLayout
    internal lateinit var indicatorIcon: ImageView
    internal lateinit var indicatorText: TextView
    internal lateinit var indicatorBar: ProgressBar
    internal lateinit var messageBox: LinearLayout
    internal lateinit var messageTitle: TextView
    internal lateinit var messageDetail: TextView
    internal lateinit var messagePrimary: TextView
    internal lateinit var messageSecondary: TextView
    internal lateinit var unlockButton: ImageView
    internal lateinit var panelRoot: FrameLayout
    internal lateinit var panel: LinearLayout
    internal lateinit var panelTitle: TextView
    internal lateinit var panelBack: ImageView
    internal lateinit var panelList: ListView
    internal val panelAdapter = RowAdapter(this)
    internal var panelParent: (() -> Unit)? = null

    // ═══ Lista de canales con lo que están pasando ═══
    // Debajo de cada canal: el programa actual. Sale primero de lo ya conocido y de la guía de internet
    // (local, instantáneo); para los canales visibles se le pregunta al servidor de a uno, con pausa.
    internal val listEpg = HashMap<String, EpgEntry>()
    internal val listEpgAsked = HashSet<String>()
    internal val listEpgQueue = ArrayDeque<PlaylistItem>()
    internal var listEpgBusy = false
    internal var channelListOpen = false
    internal var listScrollFirst = 0
    internal var listScrollLast = 0

    // ═══ Gestos ═══
    internal var scrollMode = ScrollMode.NONE
    internal var gestureStartVolume = 0f
    internal var gestureStartBrightness = 0.5f
    internal var gestureStartPos = 0L
    internal var gestureSeekTarget = 0L
    internal var gestureZapDelta = 0f
    internal var scaleAccum = 1f
    internal lateinit var gestureDetector: GestureDetector
    internal lateinit var scaleDetector: ScaleGestureDetector

    // ═══ Tareas programadas ═══
    internal val hideControlsRunnable = Runnable { hideControls() }
    internal val retryRunnable = Runnable {
        if (isLive) player.seekToDefaultPosition()
        player.prepare()
        player.playWhenReady = true
    }
    internal val progressRunnable: Runnable = object : Runnable {
        override fun run() {
            updateProgress()
            if (controlsVisible && !isLive) ui.postDelayed(this, 500)
        }
    }
    internal val tickRunnable: Runnable = object : Runnable {
        override fun run() {
            updateClock()
            updateEpgViews()
            val now = System.currentTimeMillis() / 1000
            val item = current
            val nowEntry = epgNow
            if (item != null && item.isLive && nowEntry != null && now >= nowEntry.stopSec) fetchEpg(item)
            if (sleepAtMs in 1..System.currentTimeMillis()) onSleepTimer()
            ui.postDelayed(this, 15_000)
        }
    }
    internal val osdHideRunnable = Runnable { osdView.animate().alpha(0f).setDuration(250).withEndAction { osdView.visibility = View.GONE }.start() }
    internal val indicatorHideRunnable = Runnable { indicator.visibility = View.GONE }
    internal val unlockHideRunnable = Runnable { unlockButton.visibility = View.GONE }
    internal val listScrollRunnable = Runnable { askListEpg(listScrollFirst, listScrollLast + 3) }
    internal val countdownRunnable: Runnable = object : Runnable {
        override fun run() {
            countdownLeft--
            if (countdownLeft <= 0) { hideMessage(); next() }
            else {
                messageDetail.text = "${items.getOrNull(currentIndex + 1)?.name ?: ""}\nEmpieza en $countdownLeft s"
                ui.postDelayed(this, 1000)
            }
        }
    }

    internal val pipReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.getIntExtra(EXTRA_PIP, 0)) {
                PIP_PLAY_PAUSE -> togglePlay()
                PIP_PREV -> prev()
                PIP_NEXT -> next()
            }
        }
    }

    internal val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            playerView.keepScreenOn = isPlaying
            updatePlayIcon()
            updatePipParams()
            // Reproduciendo: los controles se ocultan solos. En pausa se quedan visibles.
            if (isPlaying) { if (controlsVisible) scheduleHideControls() }
            else ui.removeCallbacks(hideControlsRunnable)
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            updatePlayIcon()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            loading.visibility = if (playbackState == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
            if (playbackState == Player.STATE_READY) {
                retryCount = 0
                startedOk()
                rememberLiveFormat()
                if (countdownLeft <= 0) hideMessage()
                updateProgress()
            }
            if (playbackState == Player.STATE_ENDED) onEnded()
            updatePlayIcon()
        }

        override fun onPlayerError(error: PlaybackException) {
            handleError(error)
        }

        override fun onTracksChanged(tracks: Tracks) {
            // Canal con audio que este equipo no puede reproducir: avisar en vez de dejarlo mudo sin explicación.
            val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
            if (audio.isEmpty()) return
            if (audio.none { it.isSupported }) {
                val f = audio.first().getTrackFormat(0)
                showOsd("Audio no compatible (${codecName(f.sampleMimeType) ?: f.sampleMimeType ?: "desconocido"})")
            }
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width <= 0 || videoSize.height <= 0) return
            videoW = videoSize.width
            videoH = videoSize.height
            videoAspect = videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height
            // PlayerView ajusta su marco con este mismo evento; aplicamos el nuestro después.
            ui.post { applyResize() }
            resBadge.text = resolutionLabel(videoSize.height)
            resBadge.visibility = View.VISIBLE
            updatePipParams()
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CICLO DE VIDA
    // ═══════════════════════════════════════════════════════════════════

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        resizeMode = getSharedPreferences(PREFS_PLAYER, MODE_PRIVATE).getInt(KEY_RESIZE, RESIZE_SMART)
        setupEdgeToEdge()
        parsePayload(readPayload(intent))
        markStarting()
        castContext = CastSupport.context(this)
        // Por si el reproductor se abre sin pasar por la interfaz: cargar la guía de internet ya descargada.
        ExternalEpg.ensure(this, ExternalEpg.savedCodes(this)) {
            runOnUiThread { if (!isDestroyed) current?.let { if (it.isLive && epgNow == null) fetchEpg(it) } }
        }
        buildUi()
        applyFonts(root)
        initPlayer()
        initCast()
        setupGestures()
        setupBackHandling()
        registerPipReceiver()
        loadCurrent()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        saveResumePosition()
        parsePayload(readPayload(intent))
        closePanel()
        loadCurrent()
    }

    override fun onStart() {
        super.onStart()
        hideSystemBars()
        ui.removeCallbacks(tickRunnable)
        ui.post(tickRunnable)
        val away = if (stoppedAt > 0) System.currentTimeMillis() - stoppedAt else 0L
        stoppedAt = 0L
        if (casting) { resumeOnStart = false; return }
        if (isLive && away > 3000) {
            // Volviendo a la app: en vivo se retoma desde lo que están pasando ahora.
            if (resumeOnStart) refreshStream(silent = true)
            resumeOnStart = false
            current?.let { fetchEpg(it) }
        } else if (resumeOnStart) { player.play(); resumeOnStart = false }
    }

    override fun onStop() {
        startedOk()
        saveResumePosition()
        stoppedAt = System.currentTimeMillis()
        if (casting) { super.onStop(); ui.removeCallbacks(tickRunnable); return }   // sigue sonando en el TV
        resumeOnStart = player.playWhenReady && player.playbackState != Player.STATE_ENDED
        // En vivo se suelta la conexión (libera una de las conexiones de la cuenta).
        if (isLive) player.stop() else player.pause()
        ui.removeCallbacks(tickRunnable)
        super.onStop()
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        stopCastScan()
        saveResumePosition()
        player.release()
        castPlayer?.setSessionAvailabilityListener(null)
        castPlayer?.release()
        netExecutor.shutdownNow()
        if (pipReceiverRegistered) {
            try { unregisterReceiver(pipReceiver) } catch (e: Exception) { }
            pipReceiverRegistered = false
        }
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    // ═══ Teclas y ventana flotante (la lógica está en PlayerInput.kt y PlayerPip.kt) ═══

    override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        interceptKey(event) || super.dispatchKeyEvent(event)

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean =
        handleKey(keyCode) || super.onKeyDown(keyCode, event)

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        pipOnUserLeave()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        pipModeChanged(isInPictureInPictureMode)
    }
}
