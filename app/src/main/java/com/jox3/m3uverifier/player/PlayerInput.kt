@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import com.jox3.m3uverifier.R
import kotlin.math.abs
import kotlin.math.roundToInt

// Gestos táctiles, ajuste de imagen, teclas del control remoto y botón Atrás.

// ═══════════════════════════════════════════════════════════════════
// GESTOS
// ═══════════════════════════════════════════════════════════════════

@SuppressLint("ClickableViewAccessibility")
internal fun PlayerActivity.setupGestures() {
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

internal fun PlayerActivity.startGesture() {
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

internal fun PlayerActivity.finishGesture(completed: Boolean) {
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

internal fun PlayerActivity.setVolumeFraction(fraction: Float) {
    val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val f = fraction.coerceIn(0f, 1f)
    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, (f * max).roundToInt(), 0)
    showIndicator(R.drawable.ic_volume, "${(f * 100).roundToInt()}%", (f * 100).roundToInt())
}

internal fun PlayerActivity.setBrightness(fraction: Float) {
    val f = fraction.coerceIn(0.02f, 1f)
    window.attributes = window.attributes.apply { screenBrightness = f }
    showIndicator(R.drawable.ic_brightness, "${(f * 100).roundToInt()}%", (f * 100).roundToInt())
}

internal fun PlayerActivity.applyResize() {
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

internal fun PlayerActivity.setResizeMode(mode: Int) {
    resizeMode = mode
    applyResize()
    getSharedPreferences(PREFS_PLAYER, Context.MODE_PRIVATE).edit().putInt(KEY_RESIZE, mode).apply()
    showOsd(resizeLabel(mode))
}

internal fun PlayerActivity.resizeLabel(mode: Int) = when (mode) {
    AspectRatioFrameLayout.RESIZE_MODE_FIT -> "Ver video completo"
    AspectRatioFrameLayout.RESIZE_MODE_FILL -> "Estirar a la pantalla"
    AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> "Acercar (recorta más)"
    else -> "Pantalla completa"
}

internal fun PlayerActivity.setupBackHandling() {
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

// ═══ Teclas (control remoto / Android TV / teclado) ═══

/** true si la tecla ya se usó. Con los controles ocultos, las flechas manejan el video, no botones invisibles. */
internal fun PlayerActivity.interceptKey(event: KeyEvent): Boolean {
    if (event.action != KeyEvent.ACTION_DOWN) return false
    val panelOpen = panelRoot.visibility == View.VISIBLE
    val msgOpen = messageBox.visibility == View.VISIBLE
    if (!controlsVisible && !panelOpen && !msgOpen && !locked) {
        when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER -> { onKeyDown(event.keyCode, event); return true }
        }
    }
    if (controlsVisible) scheduleHideControls()
    return false
}

/** true si la tecla es del reproductor. */
internal fun PlayerActivity.handleKey(keyCode: Int): Boolean {
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
    return false
}
