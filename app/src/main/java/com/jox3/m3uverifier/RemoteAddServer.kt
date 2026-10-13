package com.jox3.m3uverifier

import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Mini servidor web dentro de la app para agregar cuentas desde el celular.
 *
 * El TV muestra un QR con http://IP-LOCAL:PUERTO/?k=CLAVE. El celular (en la misma
 * red WiFi) abre esa página, pega uno o varios enlaces M3U y los envía. La clave
 * aleatoria evita que otro equipo de la red envíe cosas. Se apaga solo a los 15 min.
 */
class RemoteAddServer(private val onReceived: (JSONArray) -> Unit) {

    private var server: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()
    @Volatile private var running = false
    private var stopAt = 0L
    val key: String = ByteArray(6).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    var url: String = ""; private set

    /** Inicia el servidor y devuelve la dirección para el QR (o "" si no hay red local). */
    fun start(): String {
        if (running) return url
        val ip = localIp() ?: return ""
        val ss = ServerSocket()
        ss.reuseAddress = true
        var bound = false
        for (port in listOf(8765, 8766, 8767, 8780, 0)) {
            try { ss.bind(InetSocketAddress(port)); bound = true; break } catch (e: Exception) { }
        }
        if (!bound) return ""
        server = ss
        running = true
        stopAt = System.currentTimeMillis() + 15 * 60_000L
        url = "http://$ip:${ss.localPort}/?k=$key"
        pool.execute { acceptLoop(ss) }
        return url
    }

    fun stop() {
        running = false
        try { server?.close() } catch (e: Exception) { }
        server = null
    }

    private fun acceptLoop(ss: ServerSocket) {
        ss.soTimeout = 5000
        while (running) {
            if (System.currentTimeMillis() > stopAt) { stop(); break }
            try {
                val s = ss.accept()
                pool.execute { handle(s) }
            } catch (e: java.net.SocketTimeoutException) {
            } catch (e: Exception) { if (running) continue else break }
        }
    }

    private fun handle(sock: Socket) {
        sock.use { s ->
            try {
                s.soTimeout = 10_000
                val input = s.getInputStream()
                val head = readHead(input) ?: return
                val lines = head.split("\r\n")
                val parts = lines.first().split(" ")
                if (parts.size < 2) return
                val method = parts[0]
                val path = parts[1]
                val headers = lines.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
                val query = params(path.substringAfter('?', ""))
                val out = s.getOutputStream()
                fun send(code: Int, type: String, body: String) {
                    val bytes = body.toByteArray(Charsets.UTF_8)
                    val status = when (code) { 200 -> "OK"; 403 -> "Forbidden"; 404 -> "Not Found"; else -> "Bad Request" }
                    out.write("HTTP/1.1 $code $status\r\nContent-Type: $type; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
                    out.write(bytes); out.flush()
                }
                val route = path.substringBefore('?')
                when {
                    method == "GET" && route == "/" -> {
                        if (query["k"] != key) send(403, "text/html", page("El enlace venció o no es válido. Vuelve a escanear el código del TV.", false))
                        else send(200, "text/html", page("", true))
                    }
                    method == "POST" && route == "/add" -> {
                        val len = (headers["content-length"] ?: "0").toIntOrNull()?.coerceIn(0, 200_000) ?: 0
                        val body = String(readN(input, len), Charsets.UTF_8)
                        val form = params(body)
                        if (form["k"] != key) { send(403, "application/json", """{"ok":false,"msg":"Código vencido: vuelve a escanear el QR del TV"}"""); return }
                        val items = JSONArray()
                        (form["links"] ?: "").split('\n', '\r', ' ').map { it.trim() }.filter { it.startsWith("http", true) }.distinct().take(50).forEach {
                            items.put(JSONObject().put("type", "url").put("url", it))
                        }
                        val host = form["host"]?.trim().orEmpty(); val user = form["user"]?.trim().orEmpty(); val pass = form["pass"]?.trim().orEmpty()
                        if (host.isNotEmpty() && user.isNotEmpty() && pass.isNotEmpty()) {
                            items.put(JSONObject().put("type", "manual").put("host", host).put("user", user).put("pass", pass))
                        }
                        if (items.length() == 0) { send(400, "application/json", """{"ok":false,"msg":"No encontré enlaces. Pega un enlace que empiece por http o completa los tres datos."}"""); return }
                        onReceived(items)
                        val n = items.length()
                        send(200, "application/json", """{"ok":true,"msg":"Enviado al TV: $n ${if (n == 1) "cuenta" else "cuentas"}. Mira la pantalla para ver la verificación."}""")
                    }
                    else -> send(404, "text/plain", "No encontrado")
                }
            } catch (e: Exception) { }
        }
    }

    private fun readHead(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        var last4 = 0
        while (buf.size() < 16_384) {
            val b = input.read(); if (b < 0) return null
            buf.write(b)
            last4 = (last4 shl 8) or b
            if (last4 == 0x0D0A0D0A) return buf.toString("UTF-8")
        }
        return null
    }

    private fun readN(input: InputStream, n: Int): ByteArray {
        val out = ByteArray(n); var off = 0
        while (off < n) { val r = input.read(out, off, n - off); if (r < 0) break; off += r }
        return if (off == n) out else out.copyOf(off)
    }

    private fun params(s: String): Map<String, String> =
        s.split('&').filter { it.isNotEmpty() }.associate {
            val k = it.substringBefore('='); val v = it.substringAfter('=', "")
            URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
        }

    private fun page(error: String, form: Boolean): String {
        val k = key
        val formHtml = """
<p>Pega uno o varios enlaces M3U (uno por línea). Llegan al TV y se verifican solos.</p>
<form id="f"><input type="hidden" name="k" value="$k">
<label for="links">Enlaces M3U</label><textarea id="links" name="links" placeholder="http://servidor:8080/get.php?username=…&amp;password=…"></textarea>
<details><summary>O ingresa los datos de la cuenta</summary>
<label for="host">Servidor</label><input id="host" name="host" placeholder="http://servidor:8080" autocapitalize="off">
<label for="user">Usuario</label><input id="user" name="user" autocapitalize="off">
<label for="pass">Contraseña</label><input id="pass" name="pass" autocapitalize="off"></details>
<button type="submit">Enviar al TV</button></form><div id="m" class="msg"></div>
<script>
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const m=document.getElementById('m'),b=e.target.querySelector('button');b.disabled=true;b.textContent='Enviando…';
try{const r=await fetch('/add',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(e.target)).toString()});const j=await r.json();m.className='msg '+(j.ok?'ok':'err');m.textContent=j.msg;if(j.ok){e.target.reset();}}
catch(x){m.className='msg err';m.textContent='No se pudo enviar. Revisa que el celular esté en la misma red WiFi que el TV.';}
b.disabled=false;b.textContent='Enviar al TV';};
</script>"""
        val content = if (form) formHtml else "<div class='msg err'>" + error + "</div>"
        return """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Enviar cuenta al TV</title><style>
*{box-sizing:border-box}body{margin:0;background:#05101C;color:#E6F2FF;font:16px/1.45 system-ui,Roboto,sans-serif;padding:22px 18px}
h1{font-size:22px;margin:4px 0 6px}p{color:#7F9CB6;margin:0 0 18px;font-size:14.5px}
label{display:block;font-size:13px;color:#7F9CB6;margin:14px 0 6px}
textarea,input{width:100%;background:#0A1828;border:1px solid #1B3550;border-radius:12px;color:#E6F2FF;padding:12px 14px;font:inherit;font-size:15px}
textarea{min-height:120px;word-break:break-all}
button{width:100%;height:52px;margin-top:20px;border:0;border-radius:14px;background:#00D4FF;color:#03202C;font-weight:800;font-size:16px}
details{margin-top:18px;background:#0A1828;border:1px solid #1B3550;border-radius:12px;padding:6px 14px 14px}summary{padding:8px 0;color:#00D4FF;font-weight:650}
.msg{margin-top:16px;padding:12px 14px;border-radius:12px;display:none}.ok{display:block;background:rgba(46,229,157,.14);color:#2EE59D}.err{display:block;background:rgba(255,59,78,.14);color:#FF3B4E}
</style></head><body>
<h1>Enviar cuenta al TV</h1>
$content
</body></html>"""
    }

    companion object {
        /** IP de la red local (WiFi o cable), no la de datos móviles. */
        fun localIp(): String? {
            return try {
                val all = NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
                val addrs = all.sortedBy { n -> when { n.name.startsWith("wlan") -> 0; n.name.startsWith("eth") -> 1; else -> 2 } }
                    .flatMap { it.inetAddresses.toList() }
                    .filterIsInstance<Inet4Address>()
                addrs.firstOrNull { it.isSiteLocalAddress }?.hostAddress
            } catch (e: Exception) { null }
        }

        /** Código QR como imagen PNG en base64 (para mostrarla en la página). */
        fun qrPngBase64(text: String, size: Int = 480): String {
            val hints = mapOf(EncodeHintType.MARGIN to 1, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M)
            val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
            val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
            for (x in 0 until size) for (y in 0 until size) bmp.setPixel(x, y, if (m[x, y]) Color.BLACK else Color.WHITE)
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
    }
}
