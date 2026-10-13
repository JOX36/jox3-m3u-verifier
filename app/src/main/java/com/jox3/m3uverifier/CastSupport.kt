package com.jox3.m3uverifier

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider

/** Configuración de Chromecast: usa el receptor estándar de Google (no requiere registro). */
class CastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions =
        CastOptions.Builder()
            .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
            .build()

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}

object CastSupport {
    /** null si el equipo no tiene servicios de Google (muchos TV box): entonces no se muestra el botón. */
    @Suppress("DEPRECATION")
    fun context(ctx: Context): CastContext? = try { CastContext.getSharedInstance(ctx) } catch (e: Throwable) { null }

    /**
     * El Chromecast no reproduce MPEG-TS: para TV en vivo se pide la versión HLS (.m3u8),
     * que los paneles Xtream suelen ofrecer en la misma ruta.
     */
    fun castUrl(url: String, isLive: Boolean): String =
        if (isLive && url.substringBefore('?').endsWith(".ts", ignoreCase = true)) url.replaceFirst(Regex("\\.ts(\\?|$)", RegexOption.IGNORE_CASE), ".m3u8$1") else url

    fun mimeOf(url: String): String = when (url.substringBefore('?').substringAfterLast('.', "").lowercase()) {
        "m3u8" -> MimeTypes.APPLICATION_M3U8
        "mkv" -> MimeTypes.VIDEO_MATROSKA
        "ts" -> MimeTypes.VIDEO_MP2T
        "webm" -> MimeTypes.VIDEO_WEBM
        else -> MimeTypes.VIDEO_MP4
    }

    fun item(item: PlaylistItem): MediaItem {
        val url = castUrl(item.url, item.isLive)
        val meta = MediaMetadata.Builder().setTitle(item.name)
        if (item.poster.startsWith("http")) meta.setArtworkUri(Uri.parse(item.poster))
        return MediaItem.Builder().setUri(url).setMimeType(mimeOf(url)).setMediaMetadata(meta.build()).build()
    }
}
