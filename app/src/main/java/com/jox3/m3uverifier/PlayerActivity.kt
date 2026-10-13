package com.jox3.m3uverifier

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Icon
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.graphics.drawable.ColorDrawable
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.util.Rational
import android.view.GestureDetector
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import androidx.mediarouter.app.MediaRouteButton
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.roundToInt

/** Un item reproducible dentro del playlist que manda el WebView. */
data class PlaylistItem(val name: String, val url: String, val streamId: String, val isLive: Boolean, val poster: String = "")

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
 */
@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PAYLOAD_FILE = "payloadFile"
        const val EXTRA_PAYLOAD = "payload"

        private const val USER_AGENT = "VLC/3.0.0"
        private const val AUTO_HIDE_MS = 4000L
        private const val MAX_RETRIES = 4
        private const val SEEK_STEP_MS = 10_000L
        private const val NEXT_EPISODE_SECONDS = 8

        private const val PREFS_PLAYER = "jox3_player"
        private const val KEY_RESIZE = "resize_mode_v2"

        /**
         * Pantalla completa inteligente: llena la pantalla recortando como máximo
         * ~3 % por lado (la "zona segura" donde los canales nunca ponen logos ni
         * textos) y completa el resto estirando un poco la imagen.
         */
        private const val RESIZE_SMART = 100
        private const val SMART_MAX_ZOOM = 1.06f
        private const val PREFS_BRIDGE = "jox3_bridge"
        private const val KEY_PENDING_ADDS = "pending_adds"
        private const val KEY_CONTINUE = "continue_watching"
        private const val MAX_CONTINUE = 40

        private const val ACTION_PIP = "com.jox3.m3uverifier.PIP_CONTROL"
        private const val EXTRA_PIP = "control"
        private const val PIP_PLAY_PAUSE = 1
        private const val PIP_PREV = 2
        private const val PIP_NEXT = 3

        /**
         * Items que el usuario añadió a "Mi Lista" desde el reproductor y que el
         * WebView aún no ha recibido. Se guardan en disco (no en un callback
         * estático) para no perderlos aunque Android cierre la app por memoria.
         */
        /** Películas/episodios empezados y no terminados, el más reciente primero. */
        fun continueWatching(ctx: Context): String =
            ctx.getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).getString(KEY_CONTINUE, "[]") ?: "[]"

        fun takePendingAdds(ctx: Context): JSONArray {
            val prefs = ctx.getSharedPreferences(PREFS_BRIDGE, Context.MODE_PRIVATE)
            val raw = prefs.getString(KEY_PENDING_ADDS, null) ?: return JSONArray()
            prefs.edit().remove(KEY_PENDING_ADDS).apply()
            return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        }
    }

    // ═══ Colores de la marca ═══
    private val accent = Color.parseColor("#00d4ff")
    private val muted = Color.parseColor("#8fb3cc")
    private val panelBg = Color.parseColor("#B3081626")
    private val buttonBg = Color.parseColor("#5A0b1e30")
    private val liveRed = Color.parseColor("#ff3355")

    // ═══ Estado ═══
    private lateinit var player: ExoPlayer
    private var items: List<PlaylistItem> = emptyList()
    private var currentIndex = 0
    private var apiUrl = ""
    private var category = ""
    private val current: PlaylistItem? get() = items.getOrNull(currentIndex)
    private val isLive: Boolean get() = current?.isLive == true

    private var retryCount = 0
    private var controlsVisible = false
    private var locked = false
    private var userSeeking = false
    private var resumeOnStart = false
    private var videoW = 0
    private var videoH = 0
    private var resizeMode = RESIZE_SMART
    private var videoAspect = 0f
    private var contentFrame: AspectRatioFrameLayout? = null
    private var sleepAtMs = 0L
    private var countdownLeft = 0
    private var epgToken = 0
    private var epgNow: EpgEntry? = null
    private var epgNext: EpgEntry? = null
    private var pipReceiverRegistered = false
    // Chromecast
    private var castContext: CastContext? = null
    private var castPlayer: CastPlayer? = null
    private var casting = false
    private var castScanCb: MediaRouter.Callback? = null
    private var castMenuOpen = false
    // Misma letra que el resto de la app (Inter), también en el reproductor.
    private val fontRegular: Typeface by lazy { loadFont("inter-Regular.otf", Typeface.NORMAL) }
    private val fontBold: Typeface by lazy { loadFont("inter-Bold.otf", Typeface.BOLD) }
    /** El reproductor que manda en este momento: el del teléfono o el del Chromecast. */
    private val ap: Player get() = if (casting) castPlayer ?: player else player
    private var stoppedAt = 0L

    private val ui = Handler(Looper.getMainLooper())
    private var netExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private lateinit var audioManager: AudioManager

    private data class EpgEntry(val title: String, val startSec: Long, val stopSec: Long)
    private data class Row(
        val title: String,
        val subtitle: String? = null,
        val selected: Boolean = false,
        val action: (() -> Unit)? = null
    )

    // ═══ Vistas ═══
    private lateinit var root: FrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var gestureLayer: View
    private lateinit var loading: ProgressBar
    private lateinit var controls: FrameLayout
    private lateinit var topBar: LinearLayout
    private lateinit var bottomBar: LinearLayout
    private lateinit var centerRow: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var subtitleView: TextView
    private lateinit var resBadge: TextView
    private lateinit var liveBadge: TextView
    private lateinit var clockView: TextView
    private lateinit var epgBox: LinearLayout
    private lateinit var epgNowView: TextView
    private lateinit var epgProgress: ProgressBar
    private lateinit var epgNextView: TextView
    private lateinit var btnPrev: ImageView
    private lateinit var btnRewind: ImageView
    private lateinit var btnPlay: ImageView
    private lateinit var btnForward: ImageView
    private lateinit var btnNext: ImageView
    private lateinit var btnPip: ImageView
    private lateinit var seekRow: LinearLayout
    private lateinit var seekBar: SeekBar
    private lateinit var posView: TextView
    private lateinit var durView: TextView
    private lateinit var osdView: TextView
    private lateinit var indicator: LinearLayout
    private lateinit var indicatorIcon: ImageView
    private lateinit var indicatorText: TextView
    private lateinit var indicatorBar: ProgressBar
    private lateinit var messageBox: LinearLayout
    private lateinit var messageTitle: TextView
    private lateinit var messageDetail: TextView
    private lateinit var messagePrimary: TextView
    private lateinit var messageSecondary: TextView
    private lateinit var unlockButton: ImageView
    private lateinit var panelRoot: FrameLayout
    private lateinit var panel: LinearLayout
    private lateinit var panelTitle: TextView
    private lateinit var panelBack: ImageView
    private lateinit var panelList: ListView
    private val panelAdapter = RowAdapter()
    private var panelParent: (() -> Unit)? = null

    // ═══ Tareas programadas ═══
    private val hideControlsRunnable = Runnable { hideControls() }
    private val retryRunnable = Runnable {
        if (isLive) player.seekToDefaultPosition()
        player.prepare()
        player.playWhenReady = true
    }
    private val progressRunnable = object : Runnable {
        override fun run() {
            updateProgress()
            if (controlsVisible && !isLive) ui.postDelayed(this, 500)
        }
    }
    private val tickRunnable = object : Runnable {
        override fun run() {
            updateClock()
            updateEpgViews()
            val now = System.currentTimeMillis() / 1000
            val item = current
            if (item != null && item.isLive && epgNow != null && now >= epgNow!!.stopSec) fetchEpg(item)
            if (sleepAtMs in 1..System.currentTimeMillis()) onSleepTimer()
            ui.postDelayed(this, 15_000)
        }
    }
    private val osdHideRunnable = Runnable { osdView.animate().alpha(0f).setDuration(250).withEndAction { osdView.visibility = View.GONE }.start() }
    private val indicatorHideRunnable = Runnable { indicator.visibility = View.GONE }
    private val unlockHideRunnable = Runnable { unlockButton.visibility = View.GONE }
    private val countdownRunnable = object : Runnable {
        override fun run() {
            countdownLeft--
            if (countdownLeft <= 0) { hideMessage(); next() }
            else {
                messageDetail.text = "${items.getOrNull(currentIndex + 1)?.name ?: ""}\nEmpieza en $countdownLeft s"
                ui.postDelayed(this, 1000)
            }
        }
    }

    // ═══ Gestos ═══
    private enum class ScrollMode { NONE, VOLUME, BRIGHTNESS, SEEK, ZAP, IGNORED }
    private var scrollMode = ScrollMode.NONE
    private var gestureStartVolume = 0f
    private var gestureStartBrightness = 0.5f
    private var gestureStartPos = 0L
    private var gestureSeekTarget = 0L
    private var gestureZapDelta = 0f
    private var scaleAccum = 1f
    private lateinit var gestureDetector: GestureDetector
    private lateinit var scaleDetector: ScaleGestureDetector

    // ═══════════════════════════════════════════════════════════════════
    // CICLO DE VIDA
    // ═══════════════════════════════════════════════════════════════════

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        resizeMode = getSharedPreferences(PREFS_PLAYER, MODE_PRIVATE)
            .getInt(KEY_RESIZE, RESIZE_SMART)
        setupEdgeToEdge()
        parsePayload(readPayload(intent))
        castContext = CastSupport.context(this)
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

    // ═══════════════════════════════════════════════════════════════════
    // PANTALLA COMPLETA DE BORDE A BORDE
    // ═══════════════════════════════════════════════════════════════════

    private fun setupEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        // La franja negra lateral era el notch/cámara: por defecto Android no
        // dibuja la app en esa zona en horizontal. SHORT_EDGES la usa también.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        window.setBackgroundDrawable(null)
        hideSystemBars()
    }

    private fun hideSystemBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    // ═══════════════════════════════════════════════════════════════════
    // DATOS
    // ═══════════════════════════════════════════════════════════════════

    private fun readPayload(src: Intent): String {
        // La lista viaja en un archivo: una categoría con miles de canales
        // supera el límite de ~1 MB de un Intent y tumbaba la app.
        src.getStringExtra(EXTRA_PAYLOAD_FILE)?.let { path ->
            try { return File(path).readText() } catch (e: Exception) { }
        }
        return src.getStringExtra(EXTRA_PAYLOAD) ?: "{}"
    }

    private fun parsePayload(payload: String) {
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
                            poster = o.optString("poster", "")
                        )
                    )
                }
            }
        } catch (e: Exception) { }
        items = list
        if (currentIndex !in items.indices) currentIndex = 0
    }

    // ═══════════════════════════════════════════════════════════════════
    // REPRODUCTOR
    // ═══════════════════════════════════════════════════════════════════

    private fun initPlayer() {
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
            .setRenderersFactory(DefaultRenderersFactory(this).setEnableDecoderFallback(true))
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

    private val playerListener = object : Player.Listener {
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
                if (countdownLeft <= 0) hideMessage()
                updateProgress()
            }
            if (playbackState == Player.STATE_ENDED) onEnded()
            updatePlayIcon()
        }

        override fun onPlayerError(error: PlaybackException) {
            handleError(error)
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

    private fun loadCurrent(useSavedPosition: Boolean = true) {
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

        epgToken++
        epgNow = null; epgNext = null
        updateEpgViews()

        if (item.url.isEmpty()) {
            player.stop()
            showMessage("Sin URL", "Este elemento no tiene un enlace reproducible.", "Siguiente", { next() }, "Volver", { finish() })
            return
        }

        val start = if (!item.isLive && useSavedPosition) savedPosition(item.url) else 0L
        val mediaItem = MediaItem.Builder()
            .setUri(item.url)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(item.name).build())
            .build()
        if (casting) {
            player.stop()
            castLoad(item, if (item.isLive) C.TIME_UNSET else start)
            if (item.isLive && item.streamId.isNotEmpty() && apiUrl.isNotEmpty()) fetchEpg(item)
            showControls()
            return
        }
        // Pistas elegidas para el canal anterior no aplican al nuevo.
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverrides().build()
        player.setMediaItem(mediaItem, start)
        player.prepare()
        player.playWhenReady = true
        if (start > 0) showOsd("Reanudando en ${formatTime(start)}")

        if (item.isLive && item.streamId.isNotEmpty() && apiUrl.isNotEmpty()) fetchEpg(item)
        showControls()
    }

    private fun configureControlsForItem(item: PlaylistItem) {
        val multi = items.size > 1
        btnPrev.visibility = if (multi) View.VISIBLE else View.GONE
        btnNext.visibility = if (multi) View.VISIBLE else View.GONE
        btnRewind.visibility = if (item.isLive) View.GONE else View.VISIBLE
        btnForward.visibility = if (item.isLive) View.GONE else View.VISIBLE
        seekRow.visibility = if (item.isLive) View.GONE else View.VISIBLE
        epgBox.visibility = View.GONE
        updateClock()
    }

    private fun handleError(error: PlaybackException) {
        loading.visibility = View.GONE
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition()
            player.prepare()
            return
        }
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

    private fun describeError(error: PlaybackException): String {
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
            error.errorCode in 3000..3999 -> "El formato del stream no es compatible."
            error.errorCode in 4000..4999 -> "Este dispositivo no puede decodificar el video."
            else -> "Error de reproducción (${error.errorCodeName})."
        }
    }

    /** Recargar: en vivo salta a lo que están pasando ahora; en películas sigue en el mismo punto. */
    private fun refreshStream(silent: Boolean = false) {
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

    // ═══ CHROMECAST ═══
    private fun initCast() {
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

    private fun openCastMenu() {
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

    private fun showCastPanel() {
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

    private fun refreshCastMenu() {
        if (castMenuOpen && panelRoot.visibility == View.VISIBLE) ui.post { if (castMenuOpen) showCastPanel() }
    }

    private fun stopCastScan() {
        castScanCb?.let { try { MediaRouter.getInstance(this).removeCallback(it) } catch (e: Exception) { } }
        castScanCb = null
    }

    private fun castDeviceName(): String =
        try { castContext?.sessionManager?.currentCastSession?.castDevice?.friendlyName } catch (e: Exception) { null } ?: "el TV"

    private fun castLoad(item: PlaylistItem, startMs: Long) {
        val cp = castPlayer ?: return
        cp.setMediaItem(CastSupport.item(item), startMs)
        cp.prepare()
        cp.playWhenReady = true
        showCastMessage()
    }

    private fun startCasting() {
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

    private fun stopCasting() {
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

    private fun showCastMessage() {
        showMessage("Transmitiendo a ${castDeviceName()}", current?.name ?: "", "Detener transmisión", { castContext?.sessionManager?.endCurrentSession(true) })
    }

    private fun manualRetry() {
        hideMessage()
        retryCount = 0
        if (player.playerError != null) retryRunnable.run() else loadCurrent()
    }

    private fun onEnded() {
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

    private fun togglePlay() {
        val p = ap
        if (p.playbackState == Player.STATE_ENDED) { p.seekTo(0); p.play(); return }
        if (!casting && player.playerError != null) { manualRetry(); return }
        if (p.playWhenReady) p.pause() else p.play()
        if (casting) updatePlayIcon()
    }

    private fun updatePlayIcon() {
        val p = ap
        val showPause = p.playWhenReady && p.playbackState != Player.STATE_ENDED
        btnPlay.setImageResource(if (showPause) R.drawable.ic_pause else R.drawable.ic_play)
        btnPlay.contentDescription = if (showPause) "Pausar" else "Reproducir"
    }

    private fun seekBy(deltaMs: Long) {
        if (isLive) return
        val p = ap
        val dur = p.duration
        var target = p.currentPosition + deltaMs
        if (dur != C.TIME_UNSET && dur > 0) target = target.coerceAtMost((dur - 1000).coerceAtLeast(0))
        p.seekTo(target.coerceAtLeast(0))
        showOsd(if (deltaMs > 0) "+${deltaMs / 1000} s" else "−${-deltaMs / 1000} s")
        updateProgress()
    }

    private fun prev() {
        if (items.size < 2) return
        saveResumePosition()
        currentIndex = if (currentIndex - 1 < 0) items.size - 1 else currentIndex - 1
        loadCurrent()
    }

    private fun next() {
        if (items.size < 2) return
        saveResumePosition()
        currentIndex = (currentIndex + 1) % items.size
        loadCurrent()
    }

    private fun playIndex(index: Int) {
        if (index !in items.indices) return
        saveResumePosition()
        currentIndex = index
        loadCurrent()
    }

    // ═══ Reanudar películas/episodios donde quedaste ═══
    private fun resumeKey(url: String) = "pos_" + url.hashCode()

    private fun savedPosition(url: String): Long =
        getSharedPreferences(PREFS_PLAYER, MODE_PRIVATE).getLong(resumeKey(url), 0L)

    private fun clearResumePosition(url: String) {
        getSharedPreferences(PREFS_PLAYER, MODE_PRIVATE).edit().remove(resumeKey(url)).apply()
    }

    private fun saveResumePosition() {
        if (!::player.isInitialized) return
        val item = current ?: return
        if (item.isLive || item.url.isEmpty()) return
        val dur = player.duration
        val pos = player.currentPosition
        if (dur == C.TIME_UNSET || dur <= 0) return
        val sp = getSharedPreferences(PREFS_PLAYER, MODE_PRIVATE)
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

    // ═══════════════════════════════════════════════════════════════════
    // INTERFAZ
    // ═══════════════════════════════════════════════════════════════════

    @SuppressLint("SetTextI18n")
    private fun buildUi() {
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        playerView = PlayerView(this).apply {
            useController = false
            setShutterBackgroundColor(Color.BLACK)
            setKeepContentOnPlayerReset(true)
        }
        root.addView(playerView, matchParent())
        contentFrame = playerView.findViewById(androidx.media3.ui.R.id.exo_content_frame)
        applyResize()
        root.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, orr, ob ->
            // Pantalla girada, ventana flotante, multiventana: recalcular el ajuste.
            if (r - l != orr - ol || b - t != ob - ot) ui.post { applyResize() }
        }

        gestureLayer = View(this)
        root.addView(gestureLayer, matchParent())

        loading = ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(accent)
            visibility = View.GONE
        }
        root.addView(loading, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))

        controls = FrameLayout(this).apply { alpha = 0f; visibility = View.INVISIBLE }
        root.addView(controls, matchParent())
        buildTopBar()
        buildCenterRow()
        buildBottomBar()

        osdView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(typeface, Typeface.BOLD)
            background = rounded(Color.parseColor("#CC081626"), dp(20).toFloat())
            setPadding(dp(18), dp(8), dp(18), dp(8))
            visibility = View.GONE
        }
        root.addView(osdView, FrameLayout.LayoutParams(wrap(), wrap(), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(88) })

        buildIndicator()
        buildMessageBox()

        unlockButton = circleButton(R.drawable.ic_lock, 52, 14, buttonBg, "Desbloquear") { setLocked(false) }
        unlockButton.visibility = View.GONE
        root.addView(unlockButton, FrameLayout.LayoutParams(dp(52), dp(52), Gravity.CENTER_VERTICAL or Gravity.START).apply { marginStart = dp(32) })

        buildPanel()

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            // El video sí ocupa el notch; los botones se apartan de él.
            val cut = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            topBar.setPadding(dp(16) + cut.left, dp(14) + cut.top, dp(16) + cut.right, dp(40))
            bottomBar.setPadding(dp(16) + cut.left, dp(36), dp(16) + cut.right, dp(12) + cut.bottom)
            panel.setPadding(0, cut.top, cut.right, cut.bottom)
            unlockButton.layoutParams = (unlockButton.layoutParams as FrameLayout.LayoutParams).apply { marginStart = dp(32) + cut.left }
            insets
        }

        setContentView(root)
    }

    private fun buildTopBar() {
        topBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor("#E6000000"), Color.parseColor("#00000000"))
            )
            setPadding(dp(16), dp(14), dp(16), dp(40))
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(circleButton(R.drawable.ic_back, 44, 11, buttonBg, "Volver") { finish() })

        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titleView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        subtitleView = TextView(this).apply {
            setTextColor(muted)
            textSize = 12f
            maxLines = 1
        }
        titles.addView(titleView)
        titles.addView(subtitleView)
        row.addView(titles, LinearLayout.LayoutParams(0, wrap(), 1f).apply { marginStart = dp(12); marginEnd = dp(8) })

        liveBadge = pill("EN VIVO", Color.WHITE, liveRed)
        row.addView(liveBadge, LinearLayout.LayoutParams(wrap(), wrap()).apply { marginEnd = dp(8) })
        resBadge = pill("", accent, Color.parseColor("#33081626")).apply {
            background = GradientDrawable().apply {
                cornerRadius = dp(6).toFloat()
                setStroke(dp(1), accent)
            }
            visibility = View.GONE
        }
        row.addView(resBadge, LinearLayout.LayoutParams(wrap(), wrap()).apply { marginEnd = dp(10) })
        clockView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
        }
        row.addView(clockView, LinearLayout.LayoutParams(wrap(), wrap()).apply { marginEnd = dp(10) })
        castContext?.let { ctx ->
            try {
                // El selector de dispositivos es propio (con los colores de la app), no el diálogo gris de Android.
                val b = object : MediaRouteButton(this) {
                    override fun performClick(): Boolean { openCastMenu(); return true }
                }
                CastButtonFactory.setUpMediaRouteButton(applicationContext, b)
                b.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(buttonBg) }
                b.setPadding(dp(4), dp(4), dp(4), dp(4))
                b.contentDescription = "Transmitir a Chromecast"
                // Solo aparece cuando hay un Chromecast o TV compatible en la red.
                row.addView(b, LinearLayout.LayoutParams(dp(44), dp(44)).apply { marginEnd = dp(8) })
            } catch (e: Exception) { }
        }
        row.addView(circleButton(R.drawable.ic_reload, 44, 11, buttonBg, "Recargar") { refreshStream() })
        row.addView(spacer(8))
        row.addView(circleButton(R.drawable.ic_add, 44, 11, buttonBg, "Añadir a Mi Lista") { addToList() })
        row.addView(spacer(8))
        // Bloquear la pantalla solo tiene sentido en pantallas táctiles.
        if (!tv) row.addView(circleButton(R.drawable.ic_lock_open, 44, 11, buttonBg, "Bloquear pantalla") { setLocked(true) })
        topBar.addView(row)

        // EPG: ahora / después, con barra de avance del programa.
        epgBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(dp(56), dp(10), dp(0), 0)
        }
        epgNowView = TextView(this).apply { setTextColor(Color.WHITE); textSize = 13f; maxLines = 1 }
        epgProgress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 1000
            progressTintList = ColorStateList.valueOf(accent)
            progressBackgroundTintList = ColorStateList.valueOf(Color.parseColor("#55FFFFFF"))
        }
        epgNextView = TextView(this).apply { setTextColor(muted); textSize = 12f; maxLines = 1 }
        epgBox.addView(epgNowView)
        epgBox.addView(epgProgress, LinearLayout.LayoutParams(dp(260), dp(4)).apply { topMargin = dp(5); bottomMargin = dp(5) })
        epgBox.addView(epgNextView)
        topBar.addView(epgBox)

        controls.addView(topBar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, wrap(), Gravity.TOP))
    }

    private fun buildCenterRow() {
        centerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        btnPrev = circleButton(R.drawable.ic_prev, 46, 12, buttonBg, "Anterior") { prev() }
        btnRewind = circleButton(R.drawable.ic_rewind, 46, 12, buttonBg, "Retroceder 10 segundos") { seekBy(-SEEK_STEP_MS) }
        btnPlay = circleButton(R.drawable.ic_pause, 58, 15, accent, "Pausar") { togglePlay() }
        btnForward = circleButton(R.drawable.ic_forward, 46, 12, buttonBg, "Adelantar 10 segundos") { seekBy(SEEK_STEP_MS) }
        btnNext = circleButton(R.drawable.ic_next, 46, 12, buttonBg, "Siguiente") { next() }
        listOf(btnPrev, btnRewind, btnPlay, btnForward, btnNext).forEach { b ->
            centerRow.addView(b, (b.layoutParams as LinearLayout.LayoutParams).apply { marginStart = dp(12); marginEnd = dp(12) })
        }
        controls.addView(centerRow, FrameLayout.LayoutParams(wrap(), wrap(), Gravity.CENTER))
    }

    private fun buildBottomBar() {
        bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable(
                GradientDrawable.Orientation.BOTTOM_TOP,
                intArrayOf(Color.parseColor("#E6000000"), Color.parseColor("#00000000"))
            )
            setPadding(dp(16), dp(36), dp(16), dp(12))
        }

        seekRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        posView = TextView(this).apply { setTextColor(Color.WHITE); textSize = 13f; text = "0:00" }
        durView = TextView(this).apply { setTextColor(muted); textSize = 13f; text = "0:00" }
        seekBar = SeekBar(this).apply {
            max = 1000
            progressTintList = ColorStateList.valueOf(accent)
            thumbTintList = ColorStateList.valueOf(accent)
            secondaryProgressTintList = ColorStateList.valueOf(Color.parseColor("#88FFFFFF"))
            progressBackgroundTintList = ColorStateList.valueOf(Color.parseColor("#44FFFFFF"))
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    val dur = player.duration
                    if (dur != C.TIME_UNSET && dur > 0) posView.text = formatTime(dur * progress / 1000)
                }
                override fun onStartTrackingTouch(sb: SeekBar?) {
                    userSeeking = true
                    ui.removeCallbacks(hideControlsRunnable)
                }
                override fun onStopTrackingTouch(sb: SeekBar?) {
                    userSeeking = false
                    val dur = ap.duration
                    if (dur != C.TIME_UNSET && dur > 0 && sb != null) ap.seekTo(dur * sb.progress / 1000)
                    scheduleHideControls()
                }
            })
        }
        seekRow.addView(posView)
        seekRow.addView(seekBar, LinearLayout.LayoutParams(0, wrap(), 1f).apply { marginStart = dp(8); marginEnd = dp(8) })
        seekRow.addView(durView)
        bottomBar.addView(seekRow)

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        actions.addView(circleButton(R.drawable.ic_list, 44, 11, buttonBg, "Lista de canales") { openChannelList() })
        actions.addView(spacer(12))
        actions.addView(circleButton(R.drawable.ic_tune, 44, 11, buttonBg, "Ajustes") { openSettings() })
        actions.addView(spacer(12))
        btnPip = circleButton(R.drawable.ic_pip, 44, 11, buttonBg, "Ventana flotante") { enterPip() }
        if (!supportsPip()) btnPip.visibility = View.GONE
        actions.addView(btnPip)
        bottomBar.addView(actions, LinearLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, wrap()).apply { topMargin = dp(6) })

        controls.addView(bottomBar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, wrap(), Gravity.BOTTOM))
    }

    private fun buildIndicator() {
        indicator = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = rounded(Color.parseColor("#CC081626"), dp(16).toFloat())
            setPadding(dp(22), dp(16), dp(22), dp(16))
            visibility = View.GONE
        }
        indicatorIcon = ImageView(this)
        indicatorText = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        indicatorBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = ColorStateList.valueOf(accent)
            progressBackgroundTintList = ColorStateList.valueOf(Color.parseColor("#44FFFFFF"))
        }
        indicator.addView(indicatorIcon, LinearLayout.LayoutParams(dp(30), dp(30)))
        indicator.addView(indicatorText, LinearLayout.LayoutParams(wrap(), wrap()).apply { topMargin = dp(6) })
        indicator.addView(indicatorBar, LinearLayout.LayoutParams(dp(120), dp(4)).apply { topMargin = dp(8) })
        root.addView(indicator, FrameLayout.LayoutParams(wrap(), wrap(), Gravity.CENTER))
    }

    private fun buildMessageBox() {
        messageBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = rounded(Color.parseColor("#E6081626"), dp(18).toFloat())
            setPadding(dp(28), dp(22), dp(28), dp(20))
            visibility = View.GONE
            isClickable = true
        }
        messageTitle = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 19f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        messageDetail = TextView(this).apply {
            setTextColor(muted); textSize = 14f
            gravity = Gravity.CENTER
            maxWidth = dp(420)
        }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        messagePrimary = textButton(accent, Color.parseColor("#020b18"))
        messageSecondary = textButton(Color.parseColor("#33FFFFFF"), Color.WHITE)
        buttons.addView(messagePrimary)
        buttons.addView(spacer(12))
        buttons.addView(messageSecondary)
        messageBox.addView(messageTitle)
        messageBox.addView(messageDetail, LinearLayout.LayoutParams(wrap(), wrap()).apply { topMargin = dp(6) })
        messageBox.addView(buttons, LinearLayout.LayoutParams(wrap(), wrap()).apply { topMargin = dp(16) })
        root.addView(messageBox, FrameLayout.LayoutParams(wrap(), wrap(), Gravity.CENTER))
    }

    private fun buildPanel() {
        panelRoot = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#26000000"))
            visibility = View.GONE
            setOnClickListener { closePanel() }
        }
        panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(panelBg)
            isClickable = true
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(12), dp(16), dp(8))
        }
        panelBack = circleButton(R.drawable.ic_back, 40, 10, Color.TRANSPARENT, "Atrás") { panelGoBack() }
        panelTitle = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 17f
            setTypeface(typeface, Typeface.BOLD)
        }
        header.addView(panelBack)
        header.addView(panelTitle, LinearLayout.LayoutParams(0, wrap(), 1f).apply { marginStart = dp(8) })
        panel.addView(header)
        panelList = ListView(this).apply {
            adapter = panelAdapter
            selector = ColorDrawable(Color.parseColor("#4400d4ff"))
            itemsCanFocus = false
            isFocusable = true
            divider = null
            dividerHeight = 0
            isVerticalScrollBarEnabled = true
            setOnItemClickListener { _, _, position, _ ->
                panelAdapter.rows.getOrNull(position)?.action?.invoke()
            }
        }
        panel.addView(panelList, LinearLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        panelRoot.addView(panel, FrameLayout.LayoutParams(dp(360), FrameLayout.LayoutParams.MATCH_PARENT, Gravity.END))
        root.addView(panelRoot, matchParent())
    }

    // ═══ Mostrar / ocultar controles ═══
    private fun scheduleHideControls() {
        ui.removeCallbacks(hideControlsRunnable)
        if (player.isPlaying && !userSeeking && panelRoot.visibility != View.VISIBLE) {
            ui.postDelayed(hideControlsRunnable, AUTO_HIDE_MS)
        }
    }

    private fun showControls() {
        if (locked || isInPip()) return
        if (tv && !controls.hasFocus()) ui.post { if (controlsVisible && panelRoot.visibility != View.VISIBLE) btnPlay.requestFocus() }
        controlsVisible = true
        controls.visibility = View.VISIBLE
        controls.animate().cancel()
        controls.animate().alpha(1f).setDuration(180).start()
        updateEpgViews()
        updateProgress()
        ui.removeCallbacks(progressRunnable)
        if (!isLive) ui.post(progressRunnable)
        scheduleHideControls()
    }

    private fun hideControls() {
        controlsVisible = false
        if (controls.hasFocus()) { gestureLayer.isFocusable = true; gestureLayer.requestFocus() }
        ui.removeCallbacks(hideControlsRunnable)
        ui.removeCallbacks(progressRunnable)
        controls.animate().cancel()
        controls.animate().alpha(0f).setDuration(220).withEndAction {
            if (!controlsVisible) controls.visibility = View.INVISIBLE
        }.start()
    }

    private fun toggleControls() {
        if (controlsVisible) hideControls() else showControls()
    }

    private fun setLocked(lock: Boolean) {
        locked = lock
        if (lock) {
            hideControls()
            closePanel()
            showOsd("Pantalla bloqueada")
            flashUnlockButton()
        } else {
            ui.removeCallbacks(unlockHideRunnable)
            unlockButton.visibility = View.GONE
            showOsd("Pantalla desbloqueada")
            showControls()
        }
    }

    private fun flashUnlockButton() {
        unlockButton.visibility = View.VISIBLE
        ui.removeCallbacks(unlockHideRunnable)
        ui.postDelayed(unlockHideRunnable, 3000)
    }

    private fun updateProgress() {
        if (isLive || userSeeking) return
        val dur = ap.duration
        val pos = ap.currentPosition
        if (dur == C.TIME_UNSET || dur <= 0) {
            seekBar.progress = 0
            seekBar.secondaryProgress = 0
            posView.text = formatTime(pos)
            durView.text = "--:--"
            return
        }
        seekBar.progress = (pos * 1000 / dur).toInt()
        seekBar.secondaryProgress = (ap.bufferedPosition * 1000 / dur).toInt()
        posView.text = formatTime(pos)
        durView.text = formatTime(dur)
    }

    private fun updateClock() {
        clockView.text = android.text.format.DateFormat.getTimeFormat(this).format(Date())
    }

    // ═══ Mensajes ═══
    private fun showOsd(text: String) {
        osdView.text = text
        osdView.animate().cancel()
        osdView.alpha = 1f
        osdView.visibility = View.VISIBLE
        ui.removeCallbacks(osdHideRunnable)
        ui.postDelayed(osdHideRunnable, 1600)
    }

    private fun showMessage(
        title: String,
        detail: String,
        primary: String? = null, onPrimary: (() -> Unit)? = null,
        secondary: String? = null, onSecondary: (() -> Unit)? = null
    ) {
        messageTitle.text = title
        messageDetail.text = detail
        messageDetail.visibility = if (detail.isEmpty()) View.GONE else View.VISIBLE
        bindTextButton(messagePrimary, primary, onPrimary)
        bindTextButton(messageSecondary, secondary, onSecondary)
        (messagePrimary.parent as View).visibility = if (primary == null && secondary == null) View.GONE else View.VISIBLE
        messageBox.visibility = View.VISIBLE
        if (tv) ui.post { if (messagePrimary.visibility == View.VISIBLE) messagePrimary.requestFocus() else if (messageSecondary.visibility == View.VISIBLE) messageSecondary.requestFocus() }
        loading.visibility = View.GONE
    }

    private fun bindTextButton(view: TextView, label: String?, action: (() -> Unit)?) {
        if (label == null) { view.visibility = View.GONE; return }
        view.visibility = View.VISIBLE
        view.text = label
        view.setOnClickListener { action?.invoke() }
    }

    private fun hideMessage() {
        messageBox.visibility = View.GONE
    }

    private fun showIndicator(icon: Int, text: String, percent: Int?) {
        if (icon != 0) {
            indicatorIcon.visibility = View.VISIBLE
            indicatorIcon.setImageResource(icon)
        } else indicatorIcon.visibility = View.GONE
        indicatorText.text = text
        if (percent != null) {
            indicatorBar.visibility = View.VISIBLE
            indicatorBar.progress = percent.coerceIn(0, 100)
        } else indicatorBar.visibility = View.GONE
        indicator.visibility = View.VISIBLE
        ui.removeCallbacks(indicatorHideRunnable)
    }

    private fun hideIndicatorSoon() {
        ui.removeCallbacks(indicatorHideRunnable)
        ui.postDelayed(indicatorHideRunnable, 700)
    }

    // ═══════════════════════════════════════════════════════════════════
    // GESTOS
    // ═══════════════════════════════════════════════════════════════════

    @SuppressLint("ClickableViewAccessibility")
    private fun setupGestures() {
        gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean {
                scrollMode = ScrollMode.NONE
                return true
            }

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (locked) flashUnlockButton() else toggleControls()
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                if (locked) { flashUnlockButton(); return true }
                if (isLive) { toggleControls(); return true }
                val w = gestureLayer.width
                when {
                    e.x < w / 3f -> seekBy(-SEEK_STEP_MS)
                    e.x > w * 2 / 3f -> seekBy(SEEK_STEP_MS)
                    else -> togglePlay()
                }
                return true
            }

            override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
                if (locked || e1 == null || scaleDetector.isInProgress || e2.pointerCount > 1) return false
                val dx = e2.x - e1.x
                val dy = e2.y - e1.y
                if (scrollMode == ScrollMode.NONE) {
                    if (abs(dx) < dp(16) && abs(dy) < dp(16)) return false
                    // Ignorar arrastres que empiezan en los bordes (gestos del sistema).
                    val edge = dp(24)
                    if (e1.y < edge || e1.y > gestureLayer.height - edge) { scrollMode = ScrollMode.IGNORED; return false }
                    scrollMode = if (abs(dy) > abs(dx)) {
                        if (e1.x < gestureLayer.width / 2f) ScrollMode.BRIGHTNESS else ScrollMode.VOLUME
                    } else {
                        if (isLive) (if (items.size > 1) ScrollMode.ZAP else ScrollMode.IGNORED) else ScrollMode.SEEK
                    }
                    startGesture()
                }
                val h = gestureLayer.height.coerceAtLeast(1).toFloat()
                val w = gestureLayer.width.coerceAtLeast(1).toFloat()
                when (scrollMode) {
                    ScrollMode.VOLUME -> setVolumeFraction(gestureStartVolume - dy / (h * 0.7f))
                    ScrollMode.BRIGHTNESS -> setBrightness(gestureStartBrightness - dy / (h * 0.7f))
                    ScrollMode.SEEK -> {
                        val dur = player.duration
                        val span = 180_000f // ancho de pantalla = 3 minutos
                        var target = gestureStartPos + (dx / w * span).toLong()
                        if (dur != C.TIME_UNSET && dur > 0) target = target.coerceIn(0, (dur - 1000).coerceAtLeast(0)) else target = target.coerceAtLeast(0)
                        gestureSeekTarget = target
                        val diff = (target - gestureStartPos) / 1000
                        val sign = if (diff >= 0) "+" else "−"
                        showIndicator(0, "$sign${formatTime(abs(diff) * 1000)}\n${formatTime(target)}", null)
                    }
                    ScrollMode.ZAP -> {
                        gestureZapDelta = dx / w
                        val label = if (dx > 0) "Canal anterior" else "Canal siguiente"
                        showIndicator(if (dx > 0) R.drawable.ic_prev else R.drawable.ic_next, label, null)
                        indicator.alpha = (abs(gestureZapDelta) / 0.25f).coerceIn(0.3f, 1f)
                    }
                    else -> return false
                }
                return true
            }
        })
        gestureDetector.setIsLongpressEnabled(false)

        scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
                scaleAccum = 1f
                return !locked
            }
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                scaleAccum *= detector.scaleFactor
                return true
            }
            override fun onScaleEnd(detector: ScaleGestureDetector) {
                if (scaleAccum > 1.08f) setResizeMode(RESIZE_SMART)
                else if (scaleAccum < 0.92f) setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT)
            }
        })

        gestureLayer.setOnTouchListener { _, event ->
            scaleDetector.onTouchEvent(event)
            gestureDetector.onTouchEvent(event)
            if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) finishGesture(event.actionMasked == MotionEvent.ACTION_UP)
            true
        }
    }

    private fun startGesture() {
        when (scrollMode) {
            ScrollMode.VOLUME -> {
                val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                gestureStartVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / max
            }
            ScrollMode.BRIGHTNESS -> {
                val current = window.attributes.screenBrightness
                gestureStartBrightness = if (current >= 0f) current else try {
                    Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255f
                } catch (e: Exception) { 0.5f }
            }
            ScrollMode.SEEK -> { gestureStartPos = player.currentPosition; gestureSeekTarget = gestureStartPos }
            ScrollMode.ZAP -> { gestureZapDelta = 0f }
            else -> {}
        }
    }

    private fun finishGesture(completed: Boolean) {
        when (scrollMode) {
            ScrollMode.SEEK -> if (completed) { player.seekTo(gestureSeekTarget); updateProgress() }
            ScrollMode.ZAP -> {
                indicator.alpha = 1f
                if (completed && abs(gestureZapDelta) > 0.22f) { if (gestureZapDelta > 0) prev() else next() }
            }
            else -> {}
        }
        if (scrollMode != ScrollMode.NONE) hideIndicatorSoon()
        scrollMode = ScrollMode.NONE
    }

    private fun setVolumeFraction(fraction: Float) {
        val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val f = fraction.coerceIn(0f, 1f)
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, (f * max).roundToInt(), 0)
        showIndicator(R.drawable.ic_volume, "${(f * 100).roundToInt()}%", (f * 100).roundToInt())
    }

    private fun setBrightness(fraction: Float) {
        val f = fraction.coerceIn(0.02f, 1f)
        window.attributes = window.attributes.apply { screenBrightness = f }
        showIndicator(R.drawable.ic_brightness, "${(f * 100).roundToInt()}%", (f * 100).roundToInt())
    }

    private fun applyResize() {
        val frame = contentFrame
        if (resizeMode != RESIZE_SMART) {
            playerView.resizeMode = resizeMode
            if (videoAspect > 0f) frame?.setAspectRatio(videoAspect)
            return
        }
        playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        if (frame == null || videoAspect <= 0f) return
        val w = root.width
        val h = root.height
        if (w <= 0 || h <= 0 || isInPip()) { frame.setAspectRatio(videoAspect); return }
        val screen = w.toFloat() / h
        // El marco toma una proporción intermedia entre el video y la pantalla:
        // recorta hasta SMART_MAX_ZOOM y el resto de la diferencia se estira.
        val target = if (screen >= videoAspect) maxOf(videoAspect, screen / SMART_MAX_ZOOM)
        else minOf(videoAspect, screen * SMART_MAX_ZOOM)
        frame.setAspectRatio(target)
    }

    private fun setResizeMode(mode: Int) {
        resizeMode = mode
        applyResize()
        getSharedPreferences(PREFS_PLAYER, MODE_PRIVATE).edit().putInt(KEY_RESIZE, mode).apply()
        showOsd(resizeLabel(mode))
    }

    private fun resizeLabel(mode: Int) = when (mode) {
        AspectRatioFrameLayout.RESIZE_MODE_FIT -> "Ver video completo"
        AspectRatioFrameLayout.RESIZE_MODE_FILL -> "Estirar a la pantalla"
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> "Acercar (recorta más)"
        else -> "Pantalla completa"
    }

    // ═══════════════════════════════════════════════════════════════════
    // TECLAS (control remoto / Android TV / teclado)
    // ═══════════════════════════════════════════════════════════════════

    private val tv by lazy { isTvDevice(this) }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val panelOpen = panelRoot.visibility == View.VISIBLE
            val msgOpen = messageBox.visibility == View.VISIBLE
            if (!controlsVisible && !panelOpen && !msgOpen && !locked) {
                // Controles ocultos: las flechas manejan el video, no botones invisibles.
                when (event.keyCode) {
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT,
                    KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                    KeyEvent.KEYCODE_NUMPAD_ENTER -> return onKeyDown(event.keyCode, event) || true
                }
            }
            if (controlsVisible) scheduleHideControls()
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val panelOpen = panelRoot.visibility == View.VISIBLE
        when (keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_HEADSETHOOK -> { togglePlay(); showControls(); return true }
            KeyEvent.KEYCODE_MEDIA_PLAY -> { player.play(); return true }
            KeyEvent.KEYCODE_MEDIA_PAUSE -> { player.pause(); showControls(); return true }
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_MEDIA_NEXT -> { next(); return true }
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> { prev(); return true }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(SEEK_STEP_MS); return true }
            KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-SEEK_STEP_MS); return true }
        }
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) { openSettings(); return true }
        if (keyCode == KeyEvent.KEYCODE_GUIDE || keyCode == KeyEvent.KEYCODE_TV_INPUT) { openChannelList(); return true }
        if (!controlsVisible && !panelOpen && !locked) {
            when (keyCode) {
                // En vivo: arriba/abajo cambian de canal; izquierda/derecha abren la lista de canales.
                KeyEvent.KEYCODE_DPAD_UP -> { if (isLive) next() else { showControls(); btnPlay.requestFocus() }; return true }
                KeyEvent.KEYCODE_DPAD_DOWN -> { if (isLive) prev() else { showControls(); btnPlay.requestFocus() }; return true }
                KeyEvent.KEYCODE_DPAD_LEFT -> { if (!isLive) seekBy(-SEEK_STEP_MS) else openChannelList(); return true }
                KeyEvent.KEYCODE_DPAD_RIGHT -> { if (!isLive) seekBy(SEEK_STEP_MS) else openChannelList(); return true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> { showControls(); btnPlay.requestFocus(); return true }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun setupBackHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    panelRoot.visibility == View.VISIBLE -> panelGoBack()
                    locked -> flashUnlockButton()
                    controlsVisible && messageBox.visibility != View.VISIBLE -> hideControls()
                    else -> finish()
                }
            }
        })
    }

    // ═══════════════════════════════════════════════════════════════════
    // PANEL LATERAL: lista de canales y ajustes
    // ═══════════════════════════════════════════════════════════════════

    private fun openPanel(title: String, rows: List<Row>, parent: (() -> Unit)?, selection: Int = -1) {
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

    private fun closePanel() {
        if (castMenuOpen) { castMenuOpen = false; stopCastScan() }
        if (panelRoot.visibility != View.VISIBLE) return
        panel.animate().translationX(dp(400).toFloat()).setDuration(180).withEndAction {
            panelRoot.visibility = View.GONE
        }.start()
        panelParent = null
    }

    private fun panelGoBack() {
        val parent = panelParent
        if (parent != null) parent() else closePanel()
    }

    private fun openChannelList() {
        if (items.isEmpty()) return
        val title = when {
            isLive -> "Canales"
            category.equals("Series", ignoreCase = true) -> "Episodios"
            else -> category.ifEmpty { "Lista" }
        }
        val rows = items.mapIndexed { i, it ->
            Row("${i + 1}.  ${it.name}", selected = i == currentIndex) { closePanel(); if (i != currentIndex) playIndex(i) }
        }
        openPanel("$title (${items.size})", rows, null, currentIndex)
    }

    private fun openSettings() {
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

    private fun openTrackMenu(type: Int) {
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

    private fun openSpeedMenu() {
        val speeds = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
        val currentSpeed = player.playbackParameters.speed
        val rows = speeds.map { s ->
            Row(speedLabel(s), selected = abs(s - currentSpeed) < 0.01f) { player.setPlaybackSpeed(s); openSettings() }
        }
        openPanel("Velocidad", rows, { openSettings() })
    }

    private fun openResizeMenu() {
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

    private fun openSleepMenu() {
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

    private fun openStreamInfo() {
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

    // ═══ Pistas ═══
    private fun countTracks(type: Int): Int {
        var n = 0
        for (g in player.currentTracks.groups) if (g.type == type) for (i in 0 until g.length) if (g.isTrackSupported(i)) n++
        return n
    }

    private fun hasOverride(type: Int): Boolean =
        player.trackSelectionParameters.overrides.values.any { it.type == type }

    private fun currentTrackLabel(type: Int): String? {
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

    private fun trackLabel(f: Format, type: Int, n: Int): String {
        if (type == C.TRACK_TYPE_VIDEO) return if (f.height > 0) resolutionLabel(f.height) else "Calidad $n"
        val lang = languageName(f.language)
        val base = f.label?.takeIf { it.isNotBlank() } ?: lang ?: if (type == C.TRACK_TYPE_AUDIO) "Pista $n" else "Subtítulo $n"
        return if (f.label != null && lang != null && !f.label!!.contains(lang, ignoreCase = true)) "$base ($lang)" else base
    }

    private fun trackDetail(f: Format, type: Int): String? = when (type) {
        C.TRACK_TYPE_AUDIO -> listOfNotNull(codecName(f.sampleMimeType), if (f.channelCount > 0) channelsLabel(f.channelCount) else null).joinToString("  ·  ").ifEmpty { null }
        C.TRACK_TYPE_VIDEO -> listOfNotNull(if (f.width > 0) "${f.width}×${f.height}" else null, bitrateLabel(f.bitrate)).joinToString("  ·  ").ifEmpty { null }
        else -> codecName(f.sampleMimeType)
    }

    private fun languageName(code: String?): String? {
        if (code.isNullOrBlank() || code == "und" || code == C.LANGUAGE_UNDETERMINED) return null
        return try {
            val name = Locale.forLanguageTag(code).getDisplayLanguage(Locale("es"))
            if (name.isBlank() || name.equals(code, ignoreCase = true)) code.uppercase()
            else name.replaceFirstChar { it.uppercase() }
        } catch (e: Exception) { code }
    }

    private fun codecName(mime: String?): String? = when (mime) {
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

    private fun channelsLabel(c: Int) = when (c) {
        1 -> "Mono"; 2 -> "Estéreo"; 6 -> "5.1"; 8 -> "7.1"; else -> "$c canales"
    }

    private fun bitrateLabel(b: Int): String? =
        if (b <= 0) null else if (b >= 1_000_000) String.format(Locale.US, "%.1f Mbps", b / 1_000_000f) else "${b / 1000} kbps"

    private fun resolutionLabel(h: Int) = when {
        h >= 2100 -> "4K"
        h >= 1400 -> "2K"
        h >= 1000 -> "FHD 1080p"
        h >= 700 -> "HD 720p"
        else -> "SD ${h}p"
    }

    private fun speedLabel(s: Float) = if (abs(s - 1f) < 0.01f) "Normal" else "${s.toString().trimEnd('0').trimEnd('.')}x"

    private fun sleepLabel(): String {
        if (sleepAtMs == 0L) return "Desactivado"
        val left = ((sleepAtMs - System.currentTimeMillis()) / 60_000L).coerceAtLeast(0) + 1
        return "En $left min"
    }

    private fun onSleepTimer() {
        sleepAtMs = 0L
        player.pause()
        showMessage("Apagado automático", "La reproducción se pausó.", "Seguir viendo", { hideMessage(); player.play() }, "Salir", { finish() })
    }

    // ═══ Acciones ═══
    private fun copyUrl() {
        val item = current ?: return
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("stream_url", item.url))
        showOsd("URL copiada")
    }

    private fun addToList() {
        val item = current ?: return
        val prefs = getSharedPreferences(PREFS_BRIDGE, Context.MODE_PRIVATE)
        val pending = try { JSONArray(prefs.getString(KEY_PENDING_ADDS, "[]")) } catch (e: Exception) { JSONArray() }
        pending.put(JSONObject().put("name", item.name).put("url", item.url).put("category", category))
        prefs.edit().putString(KEY_PENDING_ADDS, pending.toString()).apply()
        showOsd("Añadido a Mi Lista")
    }

    // ═══════════════════════════════════════════════════════════════════
    // EPG
    // ═══════════════════════════════════════════════════════════════════

    private fun fetchEpg(item: PlaylistItem) {
        if (item.streamId.isEmpty() || apiUrl.isEmpty() || netExecutor.isShutdown) return
        val token = ++epgToken
        val urlStr = "$apiUrl&action=get_short_epg&stream_id=${item.streamId}&limit=2"
        try {
            netExecutor.execute {
                val result = mutableListOf<EpgEntry>()
                try {
                    val conn = URL(urlStr).openConnection() as HttpURLConnection
                    conn.connectTimeout = 6000
                    conn.readTimeout = 6000
                    conn.setRequestProperty("User-Agent", USER_AGENT)
                    val text = try { conn.inputStream.bufferedReader().use { it.readText() } } finally { conn.disconnect() }
                    val listings = JSONObject(text).optJSONArray("epg_listings")
                    if (listings != null) {
                        for (i in 0 until listings.length()) {
                            val o = listings.optJSONObject(i) ?: continue
                            val title = decodeMaybeBase64(o.optString("title", "")).trim()
                            val start = o.optString("start_timestamp", "0").toLongOrNull() ?: 0L
                            val stop = o.optString("stop_timestamp", "0").toLongOrNull() ?: 0L
                            if (title.isNotEmpty()) result.add(EpgEntry(title, start, stop))
                        }
                    }
                } catch (e: Exception) { /* sin EPG disponible */ }
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

    private fun updateEpgViews() {
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

    private fun decodeMaybeBase64(s: String): String {
        if (s.isEmpty()) return s
        return try {
            val decoded = String(Base64.decode(s, Base64.DEFAULT), Charsets.UTF_8)
            val readable = decoded.isNotBlank() && decoded.none { it.code in 0..8 || it == '�' }
            if (readable) decoded else s
        } catch (e: Exception) { s }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PICTURE-IN-PICTURE
    // ═══════════════════════════════════════════════════════════════════

    private fun supportsPip(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun isInPip(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode

    private fun enterPip() {
        if (!supportsPip()) { showOsd("Ventana flotante no disponible"); return }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try { enterPictureInPictureMode(buildPipParams()) } catch (e: Exception) { showOsd("No se pudo abrir la ventana flotante") }
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun buildPipParams(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder()
        if (videoW > 0 && videoH > 0) {
            val ratio = videoW.toFloat() / videoH
            val rational = when {
                ratio > 2.39f -> Rational(239, 100)
                ratio < 1 / 2.39f -> Rational(100, 239)
                else -> Rational(videoW, videoH)
            }
            builder.setAspectRatio(rational)
        }
        val actions = mutableListOf<RemoteAction>()
        if (items.size > 1) actions += remoteAction(R.drawable.ic_prev, "Anterior", PIP_PREV)
        actions += if (player.isPlaying) remoteAction(R.drawable.ic_pause, "Pausar", PIP_PLAY_PAUSE)
        else remoteAction(R.drawable.ic_play, "Reproducir", PIP_PLAY_PAUSE)
        if (items.size > 1) actions += remoteAction(R.drawable.ic_next, "Siguiente", PIP_NEXT)
        builder.setActions(actions)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(player.isPlaying)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun remoteAction(icon: Int, title: String, control: Int): RemoteAction {
        val intent = Intent(ACTION_PIP).setPackage(packageName).putExtra(EXTRA_PIP, control)
        val pending = PendingIntent.getBroadcast(
            this, control, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return RemoteAction(Icon.createWithResource(this, icon), title, title, pending)
    }

    private fun updatePipParams() {
        if (!supportsPip() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try { setPictureInPictureParams(buildPipParams()) } catch (e: Exception) { }
    }

    private val pipReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.getIntExtra(EXTRA_PIP, 0)) {
                PIP_PLAY_PAUSE -> togglePlay()
                PIP_PREV -> prev()
                PIP_NEXT -> next()
            }
        }
    }

    private fun registerPipReceiver() {
        if (!supportsPip()) return
        ContextCompat.registerReceiver(this, pipReceiver, IntentFilter(ACTION_PIP), ContextCompat.RECEIVER_NOT_EXPORTED)
        pipReceiverRegistered = true
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // En Android 12+ lo hace el sistema solo (setAutoEnterEnabled).
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.O until Build.VERSION_CODES.S && player.isPlaying && supportsPip()) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) {
            hideControls()
            closePanel()
            hideMessage()
            osdView.visibility = View.GONE
            indicator.visibility = View.GONE
            unlockButton.visibility = View.GONE
        } else {
            if (lifecycle.currentState == Lifecycle.State.CREATED) {
                // El usuario cerró la ventana flotante (la X): terminar.
                player.pause()
                finish()
                return
            }
            hideSystemBars()
            showControls()
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // AYUDAS DE INTERFAZ
    // ═══════════════════════════════════════════════════════════════════

    private fun loadFont(name: String, style: Int): Typeface =
        try { Typeface.createFromAsset(assets, "fonts/$name") } catch (e: Exception) { Typeface.create(Typeface.DEFAULT, style) }

    private fun applyFonts(v: View) {
        if (v is TextView) {
            val bold = ((v.typeface?.style ?: 0) and Typeface.BOLD) != 0
            v.typeface = if (bold) fontBold else fontRegular
        }
        if (v is ViewGroup) for (i in 0 until v.childCount) applyFonts(v.getChildAt(i))
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()
    private fun wrap() = ViewGroup.LayoutParams.WRAP_CONTENT
    private fun matchParent() = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
    private fun spacer(widthDp: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(widthDp), 1) }

    private fun rounded(color: Int, radius: Float) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
    }

    private fun circleButton(icon: Int, sizeDp: Int, padDp: Int, bg: Int, description: String, onClick: () -> Unit): ImageView {
        return ImageView(this).apply {
            setImageResource(icon)
            contentDescription = description
            val circle = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(bg) }
            val mask = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) }
            val normal = RippleDrawable(ColorStateList.valueOf(Color.parseColor("#55FFFFFF")), circle, mask)
            val focused = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(if (bg == accent) accent else Color.parseColor("#AA0b1e30"))
                setStroke(dp(3), if (bg == accent) Color.WHITE else accent)
            }
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), focused)
                addState(intArrayOf(), normal)
            }
            setPadding(dp(padDp), dp(padDp), dp(padDp), dp(padDp))
            layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
            isFocusable = true
            setOnFocusChangeListener { v, has -> v.animate().scaleX(if (has) 1.12f else 1f).scaleY(if (has) 1.12f else 1f).setDuration(120).start() }
            setOnClickListener {
                onClick()
                if (controlsVisible) scheduleHideControls()
            }
        }
    }

    private fun pill(text: String, textColor: Int, bg: Int) = TextView(this).apply {
        this.text = text
        setTextColor(textColor)
        textSize = 11f
        setTypeface(typeface, Typeface.BOLD)
        letterSpacing = 0.06f
        background = rounded(bg, dp(6).toFloat())
        setPadding(dp(8), dp(3), dp(8), dp(3))
    }

    private fun textButton(bg: Int, fg: Int) = TextView(this).apply {
        setTextColor(fg)
        textSize = 14f
        setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.CENTER
        val shape = rounded(bg, dp(22).toFloat())
        val mask = rounded(Color.WHITE, dp(22).toFloat())
        val focused = rounded(bg, dp(22).toFloat()).apply { setStroke(dp(3), if (bg == accent) Color.WHITE else accent) }
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), focused)
            addState(intArrayOf(), RippleDrawable(ColorStateList.valueOf(Color.parseColor("#55FFFFFF")), shape, mask))
        }
        setPadding(dp(20), dp(11), dp(20), dp(11))
        isFocusable = true
    }

    private fun formatTime(ms: Long): String {
        val totalSec = (ms / 1000).coerceAtLeast(0)
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
    }

    /** Adaptador simple para las listas del panel lateral (sin dependencias extra). */
    private inner class RowAdapter : BaseAdapter() {
        var rows: List<Row> = emptyList()
            set(value) { field = value; notifyDataSetChanged() }

        override fun getCount() = rows.size
        override fun getItem(position: Int): Any = rows[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val view = (convertView as? LinearLayout) ?: createRowView().also { applyFonts(it) }
            val bar = view.getChildAt(0)
            val texts = view.getChildAt(1) as LinearLayout
            val title = texts.getChildAt(0) as TextView
            val subtitle = texts.getChildAt(1) as TextView
            val row = rows[position]
            title.text = row.title
            title.setTextColor(if (row.selected) accent else Color.WHITE)
            title.typeface = if (row.selected) fontBold else fontRegular
            subtitle.text = row.subtitle ?: ""
            subtitle.visibility = if (row.subtitle.isNullOrEmpty()) View.GONE else View.VISIBLE
            bar.visibility = if (row.selected) View.VISIBLE else View.INVISIBLE
            view.alpha = if (row.action == null) 0.75f else 1f
            return view
        }

        private fun createRowView(): LinearLayout {
            val rowView = LinearLayout(this@PlayerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(52)
                setPadding(dp(8), dp(8), dp(16), dp(8))
            }
            val bar = View(this@PlayerActivity).apply { setBackgroundColor(accent) }
            rowView.addView(bar, LinearLayout.LayoutParams(dp(3), dp(28)).apply { marginEnd = dp(13) })
            val texts = LinearLayout(this@PlayerActivity).apply { orientation = LinearLayout.VERTICAL }
            val title = TextView(this@PlayerActivity).apply {
                textSize = 15f
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val subtitle = TextView(this@PlayerActivity).apply {
                textSize = 12f
                setTextColor(muted)
                maxLines = 2
            }
            texts.addView(title)
            texts.addView(subtitle)
            rowView.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            return rowView
        }
    }
}
