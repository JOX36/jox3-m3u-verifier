@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import androidx.lifecycle.Lifecycle
import android.view.View
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import androidx.annotation.OptIn
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.media3.common.util.UnstableApi
import com.jox3.m3uverifier.R

// Ventana flotante (picture-in-picture) con controles.

// ═══════════════════════════════════════════════════════════════════
// PICTURE-IN-PICTURE
// ═══════════════════════════════════════════════════════════════════

internal fun PlayerActivity.supportsPip(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

internal fun PlayerActivity.isInPip(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode

internal fun PlayerActivity.enterPip() {
    if (!supportsPip()) { showOsd("Ventana flotante no disponible"); return }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        try { enterPictureInPictureMode(buildPipParams()) } catch (e: Exception) { showOsd("No se pudo abrir la ventana flotante") }
    }
}

@RequiresApi(Build.VERSION_CODES.O)
internal fun PlayerActivity.buildPipParams(): PictureInPictureParams {
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
internal fun PlayerActivity.remoteAction(icon: Int, title: String, control: Int): RemoteAction {
    val intent = Intent(ACTION_PIP).setPackage(packageName).putExtra(EXTRA_PIP, control)
    val pending = PendingIntent.getBroadcast(
        this, control, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return RemoteAction(Icon.createWithResource(this, icon), title, title, pending)
}

internal fun PlayerActivity.updatePipParams() {
    if (!supportsPip() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try { setPictureInPictureParams(buildPipParams()) } catch (e: Exception) { }
}

internal fun PlayerActivity.registerPipReceiver() {
    if (!supportsPip()) return
    ContextCompat.registerReceiver(this, pipReceiver, IntentFilter(ACTION_PIP), ContextCompat.RECEIVER_NOT_EXPORTED)
    pipReceiverRegistered = true
}

/** Android 8–11: entrar a la ventana flotante al salir con el video andando (en 12+ lo hace el sistema). */
internal fun PlayerActivity.pipOnUserLeave() {
    if (Build.VERSION.SDK_INT in Build.VERSION_CODES.O until Build.VERSION_CODES.S && player.isPlaying && supportsPip()) enterPip()
}

internal fun PlayerActivity.pipModeChanged(inPip: Boolean) {
    if (inPip) {
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
