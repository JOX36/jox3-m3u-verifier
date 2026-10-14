package com.jox3.m3uverifier

import android.app.Application
import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Si la app se cierra por un error, se guarda qué pasó para mostrarlo al abrirla de nuevo
 * (y poder arreglarlo sin adivinar). Si el error viene del decodificador de audio FFmpeg,
 * se apaga para que el reproductor siga funcionando.
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val sw = StringWriter()
                error.printStackTrace(PrintWriter(sw))
                val trace = sw.toString()
                val version = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (e: Exception) { "" }
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date())
                File(filesDir, CRASH_FILE).writeText("Versión $version · $stamp · hilo ${thread.name}\n${trace.take(8000)}")
                if (trace.contains("ffmpeg", ignoreCase = true)) {
                    getSharedPreferences("jox3_player", Context.MODE_PRIVATE).edit()
                        .putBoolean(PlayerActivity.KEY_FFMPEG_OFF, true).commit()
                }
            } catch (t: Throwable) { }
            previous?.uncaughtException(thread, error)
        }
    }

    companion object {
        const val CRASH_FILE = "last_crash.txt"

        /** Devuelve el último error guardado (y lo borra), o "" si no hubo. */
        fun takeLastCrash(ctx: Context): String {
            val f = File(ctx.filesDir, CRASH_FILE)
            if (!f.exists()) return ""
            return try { f.readText().also { f.delete() } } catch (e: Exception) { "" }
        }
    }
}
