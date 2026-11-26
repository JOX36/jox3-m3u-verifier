package com.jox3.m3uverifier

import org.json.JSONObject
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * Prueba "Mejor señal" contra un servidor de video simulado en el propio equipo:
 * un canal rápido, uno lento, uno con un corte, uno con redirección, cuentas llenas,
 * canales que no existen y una lista HLS con varias calidades.
 */
class SignalProbeTest {

    companion object {
        private const val MEDIA_SEC = 9.92   // lo que dura sample.ts
        private lateinit var server: ServerSocket
        private var port = 0

        private fun res(name: String): ByteArray =
            SignalProbeTest::class.java.getResourceAsStream("/signal/$name")!!.use { it.readBytes() }

        @BeforeClass @JvmStatic
        fun start() {
            server = ServerSocket(0)
            port = server.localPort
            thread(isDaemon = true) {
                while (!server.isClosed) {
                    val s = try { server.accept() } catch (e: Exception) { break }
                    thread(isDaemon = true) { handle(s) }
                }
            }
        }

        @AfterClass @JvmStatic
        fun stop() { server.close() }

        private fun handle(sock: Socket) = sock.use {
            val reader = sock.getInputStream().bufferedReader()
            val line = reader.readLine() ?: return@use
            while (true) { val h = reader.readLine() ?: break; if (h.isEmpty()) break }
            val path = line.split(" ")[1]
            val out = sock.getOutputStream()
            fun head(code: Int, type: String, extra: String = "") =
                out.write("HTTP/1.1 $code X\r\nContent-Type: $type\r\nConnection: close\r\n$extra\r\n".toByteArray())
            try {
                when {
                    path == "/live/fast.ts" -> { head(200, "video/mp2t"); throttle(out, res("sample.ts"), 3.0) }
                    path == "/live/slow.ts" -> { head(200, "video/mp2t"); throttle(out, res("sample.ts"), 0.5) }
                    path == "/live/stall.ts" -> { head(200, "video/mp2t"); throttle(out, res("sample.ts"), 1.5, stallAfterSec = 1.0, stallMs = 2500) }
                    path == "/redirect.ts" -> head(302, "text/plain", "Location: /live/fast.ts\r\n")
                    path == "/full.ts" -> head(509, "text/plain")
                    path.startsWith("/hls/") -> {
                        val name = path.removePrefix("/hls/")
                        val bytes = res(name)
                        val type = if (name.endsWith(".m3u8")) "application/vnd.apple.mpegurl" else "video/mp2t"
                        head(200, type, "Content-Length: ${bytes.size}\r\n")
                        out.write(bytes)
                    }
                    else -> head(404, "text/plain")
                }
                out.flush()
            } catch (e: Exception) { /* el cliente cortó: normal */ }
        }

        /** Envía el video a "speed" veces el tiempo real; opcionalmente se queda callado un rato. */
        private fun throttle(out: OutputStream, bytes: ByteArray, speed: Double, stallAfterSec: Double = -1.0, stallMs: Long = 0) {
            val bytesPerSec = bytes.size / MEDIA_SEC * speed
            val chunk = 4096
            var sent = 0
            var stalled = false
            val t0 = System.nanoTime()
            while (sent < bytes.size) {
                val n = minOf(chunk, bytes.size - sent)
                out.write(bytes, sent, n); out.flush()
                sent += n
                val mediaSent = sent / (bytes.size / MEDIA_SEC)
                if (!stalled && stallAfterSec >= 0 && mediaSent >= stallAfterSec) { stalled = true; Thread.sleep(stallMs) }
                val due = (sent / bytesPerSec * 1000).toLong() + (if (stalled) stallMs else 0)
                val now = (System.nanoTime() - t0) / 1_000_000
                if (due > now) Thread.sleep(due - now)
            }
        }
    }

    private fun probe(path: String, cancelled: () -> Boolean = { false }): JSONObject =
        SignalProbe.probe("http://127.0.0.1:$port$path", cancelled)

    @Test
    fun canalRapido_tieneFluidezAlta() {
        val r = probe("/live/fast.ts")
        assertTrue(r.toString(), r.getBoolean("ok"))
        assertEquals("TS", r.getString("kind"))
        val ratio = r.getDouble("ratio")
        assertTrue("fluidez $ratio", ratio in 2.0..4.0)
        assertTrue(r.toString(), r.getLong("kbps") in 150..400)
        assertEquals(0, r.getInt("stalls"))
    }

    @Test
    fun canalLento_quedaPorDebajoDeTiempoReal() {
        val r = probe("/live/slow.ts")
        assertTrue(r.toString(), r.getBoolean("ok"))
        val ratio = r.getDouble("ratio")
        assertTrue("fluidez $ratio", ratio in 0.3..0.75)
    }

    @Test
    fun canalConCorte_seDetecta() {
        val r = probe("/live/stall.ts")
        assertTrue(r.toString(), r.getInt("stalls") >= 1)
        assertTrue(r.toString(), r.getLong("maxGapMs") >= 2000)
    }

    @Test
    fun redireccion_seSigue() {
        val r = probe("/redirect.ts")
        assertTrue(r.toString(), r.getBoolean("ok"))
        assertTrue(r.toString(), r.getDouble("ratio") > 2.0)
    }

    @Test
    fun cuentaLlena_mensajeClaro() {
        val r = probe("/full.ts")
        assertFalse(r.getBoolean("ok"))
        assertTrue(r.toString(), r.getString("error").contains("Conexiones llenas"))
    }

    @Test
    fun canalInexistente_404() {
        val r = probe("/nada.ts")
        assertFalse(r.getBoolean("ok"))
        assertTrue(r.toString(), r.getString("error").contains("404"))
    }

    @Test
    fun hls_eligeLaMejorCalidadYMideSegmentos() {
        val r = probe("/hls/master.m3u8")
        assertTrue(r.toString(), r.getBoolean("ok"))
        assertEquals("HLS", r.getString("kind"))
        assertEquals("160x90", r.getString("resolution"))
        assertEquals(3, r.getInt("segments"))
        assertEquals(6.0, r.getDouble("mediaSec"), 0.01)
        assertTrue(r.toString(), r.getDouble("ratio") > 5)
    }

    @Test
    fun cancelar_detieneLaPrueba() {
        val r = probe("/live/slow.ts") { true }
        assertTrue(r.toString(), r.optBoolean("cancelled"))
        assertTrue(r.toString(), r.getLong("totalMs") < 3000)
    }

    @Test
    fun servidorApagado_conexionRechazada() {
        val closed = ServerSocket(0).let { val p = it.localPort; it.close(); p }
        val r = SignalProbe.probe("http://127.0.0.1:$closed/live/x.ts") { false }
        assertFalse(r.getBoolean("ok"))
        assertEquals("Conexión rechazada", r.getString("error"))
    }
}
