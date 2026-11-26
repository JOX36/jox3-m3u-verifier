package com.jox3.m3uverifier

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * "Mejor señal": prueba qué tan bien entrega un servidor un canal en vivo, sin mostrarlo.
 *
 * No mira la resolución. Mide lo que hace que un canal se vea fluido:
 *  - Arranque: cuánto tarda en llegar el primer pedazo de video.
 *  - Fluidez: cuántos segundos de video llegan por cada segundo de espera.
 *    1× = llega justo a tiempo (cualquier bajón lo congela); 2× = sobra margen.
 *    En TS se cuenta con el reloj interno del video (PCR); en HLS, con lo que dura cada segmento
 *    frente a lo que tarda en bajar.
 *  - Cortes: pausas de más de 1 s sin recibir nada.
 *
 * Devuelve un JSON con las medidas; el puntaje lo calcula la interfaz (signal.js).
 */
object SignalProbe {
    private const val UA = "VLC/3.0.0"
    private const val TS_WINDOW_MS = 6_000L      // cuánto video TS se escucha
    private const val HARD_LIMIT_MS = 14_000L    // tope por opción, pase lo que pase
    private const val HLS_SEGMENTS = 3
    private const val MAX_SEGMENT_BYTES = 20L * 1024 * 1024
    private const val MAX_PLAYLIST_BYTES = 2 * 1024 * 1024

    private class Cancelled : Exception()
    private class Opened(val conn: HttpURLConnection, val url: URL, val code: Int)

    fun probe(url: String, cancelled: () -> Boolean): JSONObject {
        val r = JSONObject()
        val t0 = System.nanoTime()
        var conn: HttpURLConnection? = null
        try {
            val o = open(url)
            conn = o.conn
            r.put("ttfbMs", ms(t0))
            r.put("code", o.code)
            if (o.code !in 200..299) return fail(r, "El servidor respondió ${o.code}", t0)
            val type = (o.conn.contentType ?: "").lowercase()
            val input = BufferedInputStream(o.conn.inputStream, 64 * 1024)
            input.mark(64)
            val head = ByteArray(7)
            val n = readSome(input, head)
            if (n <= 0) return fail(r, "No envió video", t0)
            val firstByteNs = System.nanoTime()
            input.reset()
            val isHls = type.contains("mpegurl") || o.url.path.endsWith(".m3u8", ignoreCase = true) ||
                (n >= 7 && String(head, 0, 7, Charsets.US_ASCII) == "#EXTM3U")
            if (isHls) {
                val text = readText(input)
                conn.disconnect(); conn = null
                probeHls(r, o.url, text, t0, cancelled)
            } else {
                r.put("startMs", (firstByteNs - t0) / 1_000_000)
                probeTs(r, input, t0, firstByteNs, cancelled)
            }
        } catch (e: Cancelled) {
            r.put("cancelled", true)
        } catch (e: Exception) {
            fail(r, reason(e), t0)
        } finally {
            conn?.disconnect()
        }
        r.put("totalMs", ms(t0))
        return r
    }

    // ═══ TS: escuchar el canal unos segundos y contar el video con su propio reloj ═══

    private fun probeTs(r: JSONObject, input: InputStream, t0: Long, firstByteNs: Long, cancelled: () -> Boolean) {
        r.put("kind", "TS")
        val parser = TsClock()
        val buf = ByteArray(64 * 1024)
        var bytes = 0L
        var lastDataNs = firstByteNs
        var maxGapMs = 0L
        var stalls = 0
        var ended = false
        while (true) {
            if (cancelled()) throw Cancelled()
            val now = System.nanoTime()
            if (now - firstByteNs >= TS_WINDOW_MS * 1_000_000) break
            if (now - t0 >= HARD_LIMIT_MS * 1_000_000) break
            val n = try { input.read(buf) } catch (e: SocketTimeoutException) {
                // Más de 5 s sin recibir nada: corte seguro.
                val gap = (System.nanoTime() - lastDataNs) / 1_000_000
                if (gap > maxGapMs) maxGapMs = gap
                stalls++
                break
            }
            if (n < 0) { ended = true; break }
            if (n == 0) continue
            val t = System.nanoTime()
            val gap = (t - lastDataNs) / 1_000_000
            if (bytes > 0) {
                if (gap > maxGapMs) maxGapMs = gap
                if (gap >= 1000) stalls++
            }
            lastDataNs = t
            bytes += n
            parser.feed(buf, n)
        }
        val wallSec = (System.nanoTime() - firstByteNs) / 1e9
        val mediaSec = parser.mediaTicks / 90_000.0
        r.put("bytes", bytes)
        r.put("maxGapMs", maxGapMs)
        r.put("stalls", stalls)
        r.put("wallSec", round2(wallSec))
        if (mediaSec > 0.3) {
            r.put("mediaSec", round2(mediaSec))
            r.put("ratio", round2(mediaSec / wallSec.coerceAtLeast(0.5)))
            r.put("kbps", (bytes * 8 / mediaSec / 1000).toLong())
        }
        val ok = if (mediaSec > 0.3) mediaSec >= 1.0 else bytes >= 300_000
        r.put("ok", ok)
        if (!ok) r.put("error", if (ended) "El canal se cortó enseguida" else "Llegó muy poco video")
    }

    /** Lee el reloj (PCR) de los paquetes TS para saber cuántos segundos de video llegaron. */
    private class TsClock {
        private val pkt = ByteArray(188)
        private var fill = 0
        private var pcrPid = -1
        private var lastPcr = -1L
        var mediaTicks = 0L   // en unidades de 90 kHz

        fun feed(b: ByteArray, len: Int) {
            var i = 0
            while (i < len) {
                if (fill == 0 && b[i] != SYNC) { i++; continue }   // buscar el inicio de un paquete
                val take = minOf(188 - fill, len - i)
                System.arraycopy(b, i, pkt, fill, take)
                fill += take; i += take
                if (fill == 188) { packet(); fill = 0 }
            }
        }

        private fun packet() {
            val afc = (pkt[3].toInt() shr 4) and 3
            if (afc != 2 && afc != 3) return
            if ((pkt[4].toInt() and 0xFF) < 7) return
            if ((pkt[5].toInt() and 0x10) == 0) return              // este paquete no trae reloj
            val pid = ((pkt[1].toInt() and 0x1F) shl 8) or (pkt[2].toInt() and 0xFF)
            if (pcrPid == -1) pcrPid = pid
            if (pid != pcrPid) return
            val base = ((pkt[6].toLong() and 0xFF) shl 25) or ((pkt[7].toLong() and 0xFF) shl 17) or
                ((pkt[8].toLong() and 0xFF) shl 9) or ((pkt[9].toLong() and 0xFF) shl 1) or
                ((pkt[10].toLong() and 0xFF) shr 7)
            if (lastPcr >= 0) {
                var d = base - lastPcr
                if (d < 0) d += 1L shl 33                              // el reloj da la vuelta
                if (d in 1 until 5 * 90_000L) mediaTicks += d          // saltos raros (cambio de programa) no cuentan
            }
            lastPcr = base
        }

        companion object { private const val SYNC = 0x47.toByte() }
    }

    // ═══ HLS: bajar los últimos segmentos y comparar lo que duran con lo que tardan ═══

    private fun probeHls(r: JSONObject, playlistUrl: URL, firstText: String, t0: Long, cancelled: () -> Boolean) {
        r.put("kind", "HLS")
        var mediaUrl = playlistUrl
        var text = firstText
        if (text.contains("#EXT-X-STREAM-INF")) {
            val v = bestVariant(playlistUrl, text) ?: run { fail(r, "Lista HLS sin calidades", t0); return }
            if (v.bandwidth > 0) r.put("variantKbps", v.bandwidth / 1000)
            if (v.resolution.isNotEmpty()) r.put("resolution", v.resolution)
            val o = open(v.url.toString())
            try {
                if (o.code !in 200..299) { fail(r, "La calidad respondió ${o.code}", t0); return }
                text = readText(BufferedInputStream(o.conn.inputStream))
                mediaUrl = o.url
            } finally { o.conn.disconnect() }
        }
        val segs = parseSegments(mediaUrl, text)
        if (segs.isEmpty()) { fail(r, "Lista HLS vacía", t0); return }
        val live = !text.contains("#EXT-X-ENDLIST")
        val pick = if (live) segs.takeLast(HLS_SEGMENTS) else segs.take(HLS_SEGMENTS)

        var sumDur = 0.0
        var sumDl = 0.0
        var minRatio = Double.MAX_VALUE
        var bytes = 0L
        var startMs = -1L
        var done = 0
        var stalls = 0
        var maxGapMs = 0L
        val buf = ByteArray(64 * 1024)
        for (seg in pick) {
            if (cancelled()) throw Cancelled()
            if (done > 0 && ms(t0) > HARD_LIMIT_MS) break
            val s0 = System.nanoTime()
            try {
                val o = open(seg.url.toString())
                try {
                    if (o.code !in 200..299) {
                        if (done == 0) { fail(r, "El video respondió ${o.code}", t0); return }
                        stalls++; break
                    }
                    val input = o.conn.inputStream
                    var segBytes = 0L
                    var last = System.nanoTime()
                    while (true) {
                        if (cancelled()) throw Cancelled()
                        val n = input.read(buf)
                        if (n < 0) break
                        val t = System.nanoTime()
                        if (startMs < 0 && n > 0) startMs = (t - t0) / 1_000_000
                        val gap = (t - last) / 1_000_000
                        if (gap > maxGapMs) maxGapMs = gap
                        last = t
                        segBytes += n
                        if (segBytes > MAX_SEGMENT_BYTES) break
                    }
                    val dl = ((System.nanoTime() - s0) / 1e9).coerceAtLeast(0.01)
                    sumDur += seg.duration; sumDl += dl; bytes += segBytes; done++
                    minRatio = minOf(minRatio, seg.duration / dl)
                } finally { o.conn.disconnect() }
            } catch (e: Cancelled) { throw e } catch (e: Exception) {
                if (done == 0) throw e
                stalls++; break
            }
        }
        if (done == 0 || sumDur <= 0) { fail(r, "No bajó ningún segmento", t0); return }
        r.put("ok", true)
        r.put("startMs", startMs)
        r.put("segments", done)
        r.put("mediaSec", round2(sumDur))
        r.put("ratio", round2(sumDur / sumDl))
        r.put("minRatio", round2(minRatio))
        r.put("stalls", stalls)
        r.put("maxGapMs", maxGapMs)
        r.put("bytes", bytes)
        r.put("kbps", (bytes * 8 / sumDur / 1000).toLong())
    }

    private class Variant(val url: URL, val bandwidth: Long, val resolution: String)
    private class Segment(val url: URL, val duration: Double)

    /** De una lista maestra, la calidad más alta (es la que el reproductor intenta mantener). */
    private fun bestVariant(base: URL, text: String): Variant? {
        var best: Variant? = null
        var pending: String? = null
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.startsWith("#EXT-X-STREAM-INF")) { pending = line; continue }
            if (pending != null && line.isNotEmpty() && !line.startsWith("#")) {
                val bw = Regex("""(?:^|[:,])BANDWIDTH=(\d+)""").find(pending)?.groupValues?.get(1)?.toLongOrNull() ?: 0L
                val res = Regex("""RESOLUTION=(\d+x\d+)""").find(pending)?.groupValues?.get(1) ?: ""
                val v = Variant(URL(base, line), bw, res)
                if (best == null || bw > best.bandwidth) best = v
                pending = null
            }
        }
        return best
    }

    private fun parseSegments(base: URL, text: String): List<Segment> {
        val out = mutableListOf<Segment>()
        var dur = -1.0
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.startsWith("#EXTINF:")) {
                dur = line.substringAfter(':').substringBefore(',').trim().toDoubleOrNull() ?: -1.0
                continue
            }
            if (dur > 0 && line.isNotEmpty() && !line.startsWith("#")) {
                try { out.add(Segment(URL(base, line), dur)) } catch (e: Exception) { }
                dur = -1.0
            }
        }
        return out
    }

    // ═══ Red ═══

    /** Abre la dirección siguiendo redirecciones, también de http a https y al revés (Java no lo hace solo). */
    private fun open(start: String): Opened {
        var url = URL(start)
        repeat(6) {
            val c = url.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 7000
            c.readTimeout = 5000
            c.setRequestProperty("User-Agent", UA)
            c.setRequestProperty("Accept", "*/*")
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location")
                c.disconnect()
                if (loc.isNullOrBlank()) throw IOException("Redirección sin destino")
                url = URL(url, loc)
                return@repeat
            }
            return Opened(c, url, code)
        }
        throw IOException("Demasiadas redirecciones")
    }

    private fun readSome(input: InputStream, into: ByteArray): Int {
        var got = 0
        while (got < into.size) {
            val n = input.read(into, got, into.size - got)
            if (n < 0) break
            got += n
        }
        return got
    }

    private fun readText(input: InputStream): String {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (out.size() < MAX_PLAYLIST_BYTES) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toString("UTF-8")
    }

    private fun fail(r: JSONObject, msg: String, t0: Long): JSONObject {
        r.put("ok", false)
        r.put("error", msg)
        r.put("totalMs", ms(t0))
        return r
    }

    private fun reason(e: Exception): String = when (e) {
        is SocketTimeoutException -> "No respondió a tiempo"
        is UnknownHostException -> "Servidor no encontrado"
        is ConnectException -> "Conexión rechazada"
        is SSLException -> "Error de seguridad (SSL)"
        else -> e.message?.take(80) ?: "Error de conexión"
    }

    private fun ms(t0: Long) = (System.nanoTime() - t0) / 1_000_000
    private fun round2(v: Double) = Math.round(v * 100) / 100.0
}
