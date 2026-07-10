package com.jox3.m3uverifier

import android.annotation.SuppressLint
import android.app.PictureInPictureParams
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Un item reproducible dentro del playlist que manda el WebView. */
data class PlaylistItem(val name: String, val url: String, val streamId: String, val isLive: Boolean)

/**
 * Reproductor nativo (ExoPlayer/Media3), de borde a borde de verdad (modo
 * inmersivo, sin barras del sistema), con controles circulares flotantes que
 * se ocultan solos tras unos segundos — igual que cualquier player de video.
 */
class PlayerActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView
    private lateinit var topBar: View
    private lateinit var bottomBar: View
    private lateinit var titleView: TextView
    private lateinit var resBadge: TextView
    private lateinit var liveBadge: TextView
    private lateinit var epgView: TextView
    private lateinit var playIcon: ImageView

    private var items: List<PlaylistItem> = emptyList()
    private var currentIndex = 0
    private var apiUrl: String = ""
    private var category: String = ""
    private val netExecutor = Executors.newSingleThreadExecutor()

    private val uiHandler = Handler(Looper.getMainLooper())
    private val hideControlsRunnable = Runnable { hideControls() }
    private val AUTO_HIDE_MS = 4000L
    private var controlsVisible = true

    companion object {
        var onAddToList: ((name: String, url: String, category: String) -> Unit)? = null
    }

    private val accent = Color.parseColor("#00d4ff")
    private val muted = Color.parseColor("#4a7a99")
    private var currentResizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        hideSystemBars()

        parsePayload(intent.getStringExtra("payload") ?: "{}")
        buildUi()
        loadCurrent()
        scheduleHideControls()
    }

    // ═══ MODO INMERSIVO — borde a borde de verdad, sin barra de estado ni de navegación ═══
    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
        )
    }

    @Suppress("DEPRECATION")
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun parsePayload(payload: String) {
        try {
            val json = JSONObject(payload)
            apiUrl = json.optString("apiUrl", "")
            category = json.optString("category", "")
            currentIndex = json.optInt("startIndex", 0)
            val arr = json.optJSONArray("items")
            val list = mutableListOf<PlaylistItem>()
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    list.add(
                        PlaylistItem(
                            name = o.optString("name", "Sin nombre"),
                            url = o.optString("url", ""),
                            streamId = o.optString("streamId", ""),
                            isLive = o.optBoolean("isLive", false)
                        )
                    )
                }
            }
            items = list
        } catch (e: Exception) {
            items = emptyList()
        }
        if (items.isEmpty()) {
            items = listOf(PlaylistItem("Canal", "", "", false))
            currentIndex = 0
        }
        if (currentIndex !in items.indices) currentIndex = 0
    }

    @SuppressLint("SetTextI18n")
    private fun buildUi() {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        playerView = PlayerView(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            useController = false
            resizeMode = currentResizeMode
            setOnClickListener { toggleControls() }
        }
        root.addView(playerView)

        // ═══ BARRA SUPERIOR (degradado que se difumina hacia el video, no un bloque sólido) ═══
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(36))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor("#CC020b18"), Color.parseColor("#00020b18")))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.TOP
            }
        }
        top.addView(iconButton(R.drawable.ic_back) { finish() })
        titleView = TextView(this).apply {
            setTextColor(accent)
            textSize = 15f
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(10); marginEnd = dp(10)
            }
        }
        top.addView(titleView)
        resBadge = TextView(this).apply { setTextColor(accent); textSize = 10f; setPadding(dp(8), dp(4), dp(8), dp(4)) }
        top.addView(resBadge)
        liveBadge = TextView(this).apply {
            setTextColor(Color.parseColor("#ff3355")); textSize = 11f
            setTypeface(typeface, Typeface.BOLD)
            text = "● EN VIVO"
            visibility = View.GONE
            setPadding(dp(8), 0, 0, 0)
        }
        top.addView(liveBadge)
        topBar = top
        root.addView(top)

        epgView = TextView(this).apply {
            setTextColor(muted); textSize = 12f
            setPadding(dp(20), dp(74), dp(20), 0)
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        root.addView(epgView)

        // ═══ BARRA INFERIOR ═══
        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(6), dp(28), dp(6), dp(24))
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP,
                intArrayOf(Color.parseColor("#CC020b18"), Color.parseColor("#00020b18")))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.BOTTOM
            }
        }
        bottom.addView(iconButton(R.drawable.ic_prev) { prev() })
        bottom.addView(iconButton(R.drawable.ic_reload) { retry() })
        bottom.addView(iconButtonPrimary(R.drawable.ic_pause) { togglePlay() })
        bottom.addView(iconButton(R.drawable.ic_copy) { copyUrl() })
        bottom.addView(plusButton { addToList() })
        bottom.addView(iconButton(R.drawable.ic_next) { next() })
        bottom.addView(iconButton(R.drawable.ic_aspect) { cycleResizeMode() })
        bottom.addView(iconButton(R.drawable.ic_pip) { enterPip() })
        bottomBar = bottom
        root.addView(bottom)

        setContentView(root)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun circleDrawable(colorInt: Int): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(colorInt)
    }

    private fun iconButton(iconRes: Int, onClick: () -> Unit): ImageView {
        return ImageView(this).apply {
            setImageResource(iconRes)
            background = circleDrawable(Color.parseColor("#661a2f45"))
            val pad = dp(9)
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(dp(42), dp(42)).apply { marginStart = dp(4); marginEnd = dp(4) }
            setOnClickListener { onClick(); scheduleHideControls() }
        }
    }

    private fun iconButtonPrimary(iconRes: Int, onClick: () -> Unit): ImageView {
        val iv = ImageView(this).apply {
            setImageResource(iconRes)
            background = circleDrawable(accent)
            val pad = dp(15)
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginStart = dp(6); marginEnd = dp(6) }
        }
        iv.setOnClickListener { onClick(); scheduleHideControls() }
        playIcon = iv
        return iv
    }

    private fun plusButton(onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = "+"
            setTextColor(Color.WHITE)
            textSize = 20f
            gravity = Gravity.CENTER
            background = circleDrawable(Color.parseColor("#661a2f45"))
            layoutParams = LinearLayout.LayoutParams(dp(42), dp(42)).apply { marginStart = dp(4); marginEnd = dp(4) }
            setOnClickListener { onClick(); scheduleHideControls() }
        }
    }

    // ═══ AUTO-OCULTAR CONTROLES ═══
    private fun scheduleHideControls() {
        uiHandler.removeCallbacks(hideControlsRunnable)
        uiHandler.postDelayed(hideControlsRunnable, AUTO_HIDE_MS)
    }

    private fun showControls() {
        controlsVisible = true
        topBar.animate().alpha(1f).setDuration(200).start()
        bottomBar.animate().alpha(1f).setDuration(200).start()
        epgView.animate().alpha(1f).setDuration(200).start()
        topBar.visibility = View.VISIBLE
        bottomBar.visibility = View.VISIBLE
        scheduleHideControls()
    }

    private fun hideControls() {
        controlsVisible = false
        topBar.animate().alpha(0f).setDuration(250).withEndAction { topBar.visibility = View.INVISIBLE }.start()
        bottomBar.animate().alpha(0f).setDuration(250).withEndAction { bottomBar.visibility = View.INVISIBLE }.start()
        epgView.animate().alpha(0f).setDuration(250).start()
    }

    private fun toggleControls() {
        if (controlsVisible) { uiHandler.removeCallbacks(hideControlsRunnable); hideControls() } else showControls()
    }

    private fun loadCurrent() {
        val item = items.getOrNull(currentIndex) ?: return
        titleView.text = item.name
        liveBadge.visibility = if (item.isLive) View.VISIBLE else View.GONE
        resBadge.text = ""
        epgView.text = ""
        startPlayback(item.url)
        if (item.isLive && item.streamId.isNotEmpty() && apiUrl.isNotEmpty()) fetchEpg(item.streamId)
    }

    private fun startPlayback(url: String) {
        player?.release()
        if (url.isEmpty()) return
        val exoPlayer = ExoPlayer.Builder(this).build()
        playerView.player = exoPlayer
        exoPlayer.setMediaItem(MediaItem.fromUri(url))
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                Toast.makeText(this@PlayerActivity, "❌ Sin señal — toca Reintentar", Toast.LENGTH_SHORT).show()
            }
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (videoSize.width > 0) {
                    val tag = if (videoSize.height >= 720) "HD" else "SD"
                    resBadge.text = "${videoSize.width}x${videoSize.height} $tag"
                }
            }
        })
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
        player = exoPlayer
        playIcon.setImageResource(R.drawable.ic_pause)
    }

    private fun togglePlay() {
        val p = player ?: return
        if (p.isPlaying) { p.pause(); playIcon.setImageResource(R.drawable.ic_play) }
        else { p.play(); playIcon.setImageResource(R.drawable.ic_pause) }
    }

    private fun retry() = loadCurrent()

    // Cicla: llenar pantalla (recorta bordes) → ver todo (puede dejar franjas) → estirar (sin recortes ni franjas, pero deforma un poco la imagen)
    private fun cycleResizeMode() {
        currentResizeMode = when (currentResizeMode) {
            AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> AspectRatioFrameLayout.RESIZE_MODE_FIT
            AspectRatioFrameLayout.RESIZE_MODE_FIT -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            else -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        }
        playerView.resizeMode = currentResizeMode
        val label = when (currentResizeMode) {
            AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> "🖼 Llenar pantalla (puede recortar bordes)"
            AspectRatioFrameLayout.RESIZE_MODE_FIT -> "🖼 Ver todo el video (puede haber franjas negras)"
            else -> "🖼 Estirar para llenar (sin recortes ni franjas)"
        }
        Toast.makeText(this, label, Toast.LENGTH_SHORT).show()
    }

    private fun prev() {
        if (items.isEmpty()) return
        currentIndex = if (currentIndex - 1 < 0) items.size - 1 else currentIndex - 1
        loadCurrent()
    }

    private fun next() {
        if (items.isEmpty()) return
        currentIndex = (currentIndex + 1) % items.size
        loadCurrent()
    }

    private fun copyUrl() {
        val item = items.getOrNull(currentIndex) ?: return
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("stream_url", item.url))
        Toast.makeText(this, "📋 URL copiada", Toast.LENGTH_SHORT).show()
    }

    private fun addToList() {
        val item = items.getOrNull(currentIndex) ?: return
        onAddToList?.invoke(item.name, item.url, category)
        Toast.makeText(this, "✅ Añadido a Mi Lista", Toast.LENGTH_SHORT).show()
    }

    private fun fetchEpg(streamId: String) {
        val urlStr = "$apiUrl&action=get_short_epg&stream_id=$streamId&limit=1"
        netExecutor.execute {
            try {
                val conn = URL(urlStr).openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.setRequestProperty("User-Agent", "VLC/3.0.0")
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val json = JSONObject(text)
                val listings = json.optJSONArray("epg_listings")
                if (listings != null && listings.length() > 0) {
                    val titleRaw = listings.getJSONObject(0).optString("title", "")
                    val decoded = decodeMaybeBase64(titleRaw)
                    if (decoded.isNotBlank()) runOnUiThread { epgView.text = "▸ $decoded" }
                }
            } catch (e: Exception) { /* sin EPG disponible, se deja en blanco */ }
        }
    }

    private fun decodeMaybeBase64(s: String): String {
        return try {
            val decoded = String(Base64.decode(s, Base64.DEFAULT))
            val looksReadable = decoded.isNotBlank() && decoded.none { it.code in 1..8 }
            if (looksReadable) decoded else s
        } catch (e: Exception) { s }
    }

    private fun enterPip() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            enterPictureInPictureMode(PictureInPictureParams.Builder().build())
        } else {
            Toast.makeText(this, "Picture-in-Picture no disponible en este Android", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        val vis = if (isInPictureInPictureMode) View.GONE else View.VISIBLE
        topBar.visibility = vis
        bottomBar.visibility = vis
        epgView.visibility = vis
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && player?.isPlaying == true) enterPip()
    }

    override fun onStop() {
        player?.pause()
        super.onStop()
    }

    override fun onDestroy() {
        uiHandler.removeCallbacks(hideControlsRunnable)
        player?.release()
        player = null
        netExecutor.shutdownNow()
        super.onDestroy()
    }
}
