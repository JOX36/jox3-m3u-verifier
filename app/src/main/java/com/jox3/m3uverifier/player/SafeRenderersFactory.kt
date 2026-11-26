package com.jox3.m3uverifier.player

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector

/**
 * Renderizadores del reproductor: los del equipo primero y, detrás, el decodificador de audio FFmpeg
 * (Dolby AC-3/E-AC-3, DTS, MP2…). Si FFmpeg no carga en este equipo por cualquier motivo, se sigue sin él
 * en vez de cerrar el reproductor.
 */
@OptIn(UnstableApi::class)
internal class SafeRenderersFactory(context: Context, private val useFfmpeg: Boolean) : DefaultRenderersFactory(context) {
    override fun buildAudioRenderers(
        context: Context,
        extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector,
        enableDecoderFallback: Boolean,
        audioSink: AudioSink,
        eventHandler: Handler,
        eventListener: AudioRendererEventListener,
        out: ArrayList<Renderer>
    ) {
        super.buildAudioRenderers(context, EXTENSION_RENDERER_MODE_OFF, mediaCodecSelector, enableDecoderFallback, audioSink, eventHandler, eventListener, out)
        if (!useFfmpeg) return
        try {
            if (FfmpegLibrary.isAvailable()) out.add(FfmpegAudioRenderer(eventHandler, eventListener, audioSink))
        } catch (t: Throwable) { /* sin FFmpeg en este equipo */ }
    }
}
