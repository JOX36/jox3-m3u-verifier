package com.jox3.m3uverifier

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/**
 * Reproductor nativo (ExoPlayer/Media3). Se abre desde el WebView vía el
 * puente NativePlayer definido en MainActivity. No usa layouts XML: la UI se
 * construye por código para mantener el mismo patrón que MainActivity.
 *
 * Controles fuera del video (los que ExoPlayer no trae de fábrica):
 *  - ✖ Cerrar
 *  - 🔄 Reintentar
 *  - 📋 Copiar URL
 *  - ➕ Añadir a Mi Lista (avisa al WebView vía onAddToList)
 */
class PlayerActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private lateinit var streamUrl: String
    private lateinit var title: String
    private lateinit var category: String

    companion object {
        // MainActivity lo asigna antes de lanzar este Activity, para poder
        // avisarle al WebView cuando el usuario toque "Añadir a Mi Lista"
        // sin tener que cerrar el reproductor.
        var onAddToList: ((name: String, url: String, category: String) -> Unit)? = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        streamUrl = intent.getStringExtra("url") ?: ""
        title = intent.getStringExtra("title") ?: "Canal"
        category = intent.getStringExtra("category") ?: ""

        val bg = Color.parseColor("#020b18")
        val card = Color.parseColor("#0a1f35")
        val accent = Color.parseColor("#00d4ff")

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Barra superior: título + cerrar
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(20, 24, 20, 16)
            gravity = Gravity.CENTER_VERTICAL
        }
        val titleView = TextView(this).apply {
            text = title
            setTextColor(accent)
            textSize = 16f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeBtn = Button(this).apply {
            text = "✖"
            setTextColor(Color.parseColor("#c8e8ff"))
            setBackgroundColor(bg)
            setOnClickListener { finish() }
        }
        topBar.addView(titleView)
        topBar.addView(closeBtn)

        // Video
        val playerView = PlayerView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            useController = true // controles nativos de ExoPlayer: play/pausa, volumen, pantalla completa
        }

        // Barra inferior: reintentar / copiar url / añadir a lista
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(16, 16, 16, 24)
            gravity = Gravity.CENTER
        }
        val retryBtn = actionButton("🔄 Reintentar", card, accent) { startPlayback() }
        val copyBtn = actionButton("📋 Copiar URL", card, accent) { copyUrl() }
        val addBtn = actionButton("➕ Añadir a lista", Color.parseColor("#00ff88"), Color.BLACK) { addToList() }
        bottomBar.addView(retryBtn)
        bottomBar.addView(copyBtn)
        bottomBar.addView(addBtn)

        root.addView(topBar)
        root.addView(playerView)
        root.addView(bottomBar)
        setContentView(root)

        this.playerView = playerView
        startPlayback()
    }

    private lateinit var playerView: PlayerView

    private fun actionButton(label: String, bgColor: Int, textColor: Int, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = label
            setBackgroundColor(bgColor)
            setTextColor(textColor)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = 6
                marginEnd = 6
            }
            setOnClickListener { onClick() }
        }
    }

    private fun startPlayback() {
        player?.release()
        val exoPlayer = ExoPlayer.Builder(this).build()
        playerView.player = exoPlayer
        exoPlayer.setMediaItem(MediaItem.fromUri(streamUrl))
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                Toast.makeText(this@PlayerActivity, "❌ Sin señal — toca Reintentar", Toast.LENGTH_SHORT).show()
            }
        })
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
        player = exoPlayer
    }

    private fun copyUrl() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("stream_url", streamUrl))
        Toast.makeText(this, "📋 URL copiada", Toast.LENGTH_SHORT).show()
    }

    private fun addToList() {
        onAddToList?.invoke(title, streamUrl, category)
        Toast.makeText(this, "✅ Añadido a Mi Lista", Toast.LENGTH_SHORT).show()
    }

    override fun onStop() {
        player?.pause()
        super.onStop()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        super.onDestroy()
    }
}
