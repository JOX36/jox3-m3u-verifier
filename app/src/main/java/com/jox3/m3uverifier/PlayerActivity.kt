package com.jox3.m3uverifier

import android.annotation.SuppressLint
import android.app.PictureInPictureParams
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Un item reproducible dentro del playlist que manda el WebView. */
data class PlaylistItem(val name: String, val url: String, val streamId: String, val isLive: Boolean)

/**
 * Reproductor nativo (ExoPlayer/Media3), de borde a borde, con barra de
 * controles estilo JOX3TV. No usa layouts XML: la UI se construye por código,
 * igual que MainActivity.
 *
 * Recibe del WebView un JSON ("payload") con la lista completa de canales/
 * episodios de la categoría actual — así ⏮/⏭ se manejan aquí mismo, sin ir y
 * volver al WebView cada vez que cambias de canal.
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
    private lateinit var playBtnRef: TextView

    private var items: List<PlaylistItem> = emptyList()
    private var currentIndex = 0
    private var apiUrl: String = ""
    private var category: String = ""
    private val netExecutor = Executors.newSingleThreadExecutor()

    companion object {
        // MainActivity lo asigna antes de lanzar este Activity, para poder
        // avisarle al WebView cuando el usuario toque "Añadir a Mi Lista".
        var onAddToList: ((name: String, url: String, category: String) -> Unit)? = null
    }

    private val bg = Color.parseColor("#020b18")
    private val accent = Color.parseColor("#00d4ff")
    private val muted = Color.parseColor("#4a7a99")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        parsePayload(intent.getStringExtra("payload") ?: "{}")
        buildUi()
        loadCurrent()
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
            // Por si algo llega sin playlist completo, al menos no se rompe.
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
            useController = false // controles propios (barra estilo JOX3TV), no los default de ExoPlayer
        }
        root.addView(playerView)

        // ═══ BARRA SUPERIOR: cerrar, nombre, resolución real, en vivo ═══
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(22), dp(16), dp(28))
            setBackgroundColor(Color.parseColor("#B3020b18"))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.TOP
            }
        }
        top.addView(circleButton("←") { finish() })
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
        resBadge = TextView(this).apply {
            setTextColor(accent); textSize = 10f
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        top.addView(resBadge)
        liveBadge = TextView(this).apply {
            setTextColor(Color.parseColor("#ff3355")); textSize = 11f
            setTypeface(typeface, Typeface.BOLD)
            text = "🔴 EN VIVO"
            visibility = View.GONE
            setPadding(dp(8), 0, 0, 0)
        }
        top.addView(liveBadge)
        topBar = top
        root.addView(top)

        // Línea de EPG ("qué está pasando ahora"), debajo de la barra superior
        epgView = TextView(this).apply {
            setTextColor(muted); textSize = 12f
            setPadding(dp(20), dp(78), dp(20), 0)
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        root.addView(epgView)

        // ═══ BARRA INFERIOR: ⏮ reintentar ⏸/▶ copiar añadir ⏭ pip ═══
        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(6), dp(20), dp(6), dp(28))
            setBackgroundColor(Color.parseColor("#B3020b18"))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.BOTTOM
            }
        }
        bottom.addView(circleButton("⏮") { prev() })
        bottom.addView(circleButton("🔄") { retry() })
        bottom.addView(circleButtonPrimary("⏸") { togglePlay() })
        bottom.addView(circleButton("📋") { copyUrl() })
        bottom.addView(circleButton("➕") { addToList() })
        bottom.addView(circleButton("⏭") { next() })
        bottom.addView(circleButton("▣") { enterPip() })
        bottomBar = bottom
        root.addView(bottom)

        setContentView(root)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun circleButton(label: String, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = label
            setTextColor(Color.parseColor("#c8e8ff"))
            textSize = 16f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#661a2f45"))
            layoutParams = LinearLayout.LayoutParams(dp(42), dp(42)).apply {
                marginStart = dp(4); marginEnd = dp(4)
            }
            setOnClickListener { onClick() }
        }
    }

    private fun circleButtonPrimary(label: String, onClick: () -> Unit): TextView {
        val tv = TextView(this).apply {
            text = label
            setTextColor(Color.WHITE)
            textSize = 20f
            gravity = Gravity.CENTER
            setBackgroundColor(accent)
            layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply {
                marginStart = dp(6); marginEnd = dp(6)
            }
        }
        tv.setOnClickListener { onClick() }
        playBtnRef = tv
        return tv
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
        playBtnRef.text = "⏸"
    }

    private fun togglePlay() {
        val p = player ?: return
        if (p.isPlaying) {
            p.pause(); playBtnRef.text = "▶"
        } else {
            p.play(); playBtnRef.text = "⏸"
        }
    }

    private fun retry() = loadCurrent()

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

    /** Consulta el EPG real del panel (get_short_epg) para el canal actual. */
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
                    if (decoded.isNotBlank()) {
                        runOnUiThread { epgView.text = "📺 $decoded" }
                    }
                }
            } catch (e: Exception) {
                // Sin EPG disponible para este canal — se deja en blanco, sin romper nada.
            }
        }
    }

    // Muchos paneles Xtream mandan el título del EPG en Base64.
    private fun decodeMaybeBase64(s: String): String {
        return try {
            val decoded = String(Base64.decode(s, Base64.DEFAULT))
            val looksReadable = decoded.isNotBlank() && decoded.none { it.code in 1..8 }
            if (looksReadable) decoded else s
        } catch (e: Exception) {
            s
        }
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
        // Si el usuario sale con el botón Home mientras hay video, entra a PiP solo.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && player?.isPlaying == true) {
            enterPip()
        }
    }

    override fun onStop() {
        player?.pause()
        super.onStop()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        netExecutor.shutdownNow()
        super.onDestroy()
    }
}
