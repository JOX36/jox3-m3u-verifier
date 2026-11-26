@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.annotation.SuppressLint
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.framework.CastButtonFactory
import com.jox3.m3uverifier.R
import java.util.Date

// Interfaz del reproductor: pantalla completa, barras, mensajes e indicadores.

// ═══════════════════════════════════════════════════════════════════
// PANTALLA COMPLETA DE BORDE A BORDE
// ═══════════════════════════════════════════════════════════════════

internal fun PlayerActivity.setupEdgeToEdge() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    // La franja negra lateral era el notch/cámara: por defecto Android no
    // dibuja la app en esa zona en horizontal. SHORT_EDGES la usa también.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }
    window.setBackgroundDrawable(null)
    hideSystemBars()
}

internal fun PlayerActivity.hideSystemBars() {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
}

// ═══════════════════════════════════════════════════════════════════
// INTERFAZ
// ═══════════════════════════════════════════════════════════════════

@SuppressLint("SetTextI18n")
internal fun PlayerActivity.buildUi() {
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

internal fun PlayerActivity.buildTopBar() {
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

internal fun PlayerActivity.buildCenterRow() {
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

internal fun PlayerActivity.buildBottomBar() {
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

internal fun PlayerActivity.buildIndicator() {
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

internal fun PlayerActivity.buildMessageBox() {
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

internal fun PlayerActivity.buildPanel() {
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
        // Al desplazarse por la lista de canales, pedir la guía de los que quedan a la vista.
        setOnScrollListener(object : android.widget.AbsListView.OnScrollListener {
            override fun onScrollStateChanged(view: android.widget.AbsListView, state: Int) {
                if (state == android.widget.AbsListView.OnScrollListener.SCROLL_STATE_IDLE && channelListOpen)
                    askListEpg(view.firstVisiblePosition, view.lastVisiblePosition + 3)
            }
            // Con el control remoto la lista avanza sin "soltar": se pide al quedarse quieta un momento.
            override fun onScroll(view: android.widget.AbsListView, first: Int, visible: Int, total: Int) {
                if (!channelListOpen) return
                ui.removeCallbacks(listScrollRunnable)
                listScrollFirst = first; listScrollLast = first + visible
                ui.postDelayed(listScrollRunnable, 450)
            }
        })
        setOnItemClickListener { _, _, position, _ ->
            panelAdapter.rows.getOrNull(position)?.action?.invoke()
        }
    }
    panel.addView(panelList, LinearLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 0, 1f))
    panelRoot.addView(panel, FrameLayout.LayoutParams(dp(360), FrameLayout.LayoutParams.MATCH_PARENT, Gravity.END))
    root.addView(panelRoot, matchParent())
}

// ═══ Mostrar / ocultar controles ═══
internal fun PlayerActivity.scheduleHideControls() {
    ui.removeCallbacks(hideControlsRunnable)
    if (player.isPlaying && !userSeeking && panelRoot.visibility != View.VISIBLE) {
        ui.postDelayed(hideControlsRunnable, AUTO_HIDE_MS)
    }
}

internal fun PlayerActivity.showControls() {
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

internal fun PlayerActivity.hideControls() {
    controlsVisible = false
    if (controls.hasFocus()) { gestureLayer.isFocusable = true; gestureLayer.requestFocus() }
    ui.removeCallbacks(hideControlsRunnable)
    ui.removeCallbacks(progressRunnable)
    controls.animate().cancel()
    controls.animate().alpha(0f).setDuration(220).withEndAction {
        if (!controlsVisible) controls.visibility = View.INVISIBLE
    }.start()
}

internal fun PlayerActivity.toggleControls() {
    if (controlsVisible) hideControls() else showControls()
}

internal fun PlayerActivity.setLocked(lock: Boolean) {
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

internal fun PlayerActivity.flashUnlockButton() {
    unlockButton.visibility = View.VISIBLE
    ui.removeCallbacks(unlockHideRunnable)
    ui.postDelayed(unlockHideRunnable, 3000)
}

internal fun PlayerActivity.updateProgress() {
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

internal fun PlayerActivity.updateClock() {
    clockView.text = android.text.format.DateFormat.getTimeFormat(this).format(Date())
}

// ═══ Mensajes ═══
internal fun PlayerActivity.showOsd(text: String) {
    osdView.text = text
    osdView.animate().cancel()
    osdView.alpha = 1f
    osdView.visibility = View.VISIBLE
    ui.removeCallbacks(osdHideRunnable)
    ui.postDelayed(osdHideRunnable, 1600)
}

internal fun PlayerActivity.showMessage(
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

internal fun PlayerActivity.bindTextButton(view: TextView, label: String?, action: (() -> Unit)?) {
    if (label == null) { view.visibility = View.GONE; return }
    view.visibility = View.VISIBLE
    view.text = label
    view.setOnClickListener { action?.invoke() }
}

internal fun PlayerActivity.hideMessage() {
    messageBox.visibility = View.GONE
}

internal fun PlayerActivity.showIndicator(icon: Int, text: String, percent: Int?) {
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

internal fun PlayerActivity.hideIndicatorSoon() {
    ui.removeCallbacks(indicatorHideRunnable)
    ui.postDelayed(indicatorHideRunnable, 700)
}
