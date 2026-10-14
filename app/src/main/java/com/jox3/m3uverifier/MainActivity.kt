package com.jox3.m3uverifier

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.content.FileProvider
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Detecta TV box / Android TV: modo TV del sistema o equipo sin pantalla táctil. */
fun isTvDevice(ctx: android.content.Context): Boolean {
    val ui = ctx.getSystemService(android.content.Context.UI_MODE_SERVICE) as? android.app.UiModeManager
    if (ui?.currentModeType == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION) return true
    val pm = ctx.packageManager
    return pm.hasSystemFeature("android.software.leanback") ||
        !pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_TOUCHSCREEN)
}

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var pageLoaded = false
    private var remoteServer: RemoteAddServer? = null
    private var pendingApk: File? = null

    // Pool de hilos para verificar canales en paralelo sin bloquear la UI.
    // Se recrea al cambiar de categoría para no seguir revisando la anterior.
    @Volatile
    private var checkExecutor: ExecutorService = Executors.newFixedThreadPool(6)

    // Guardar la lista .m3u: el usuario elige dónde (Descargas, Drive, etc.).
    // Las descargas tipo "blob:" del HTML no funcionan dentro de un WebView.
    private var pendingFileContent: String? = null
    private val createDocument = registerForActivityResult(
        ActivityResultContracts.CreateDocument("audio/x-mpegurl")
    ) { uri: Uri? -> writePendingFile(uri) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // El HTML hace sus peticiones con fetch hacia servidores http/https
            // de terceros (paneles Xtream); no necesita leer otros archivos locales.
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
        }

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = false

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pageLoaded = true
                deliverPendingAdds()
            }
        }

        // Puentes JS -> Kotlin.
        webView.addJavascriptInterface(NativeChecker(), "NativeChecker")
        webView.addJavascriptInterface(NativePlayer(), "NativePlayer")
        webView.addJavascriptInterface(NativeFiles(), "NativeFiles")
        webView.addJavascriptInterface(NativeApp(), "NativeApp")
        webView.addJavascriptInterface(NativeEpg(), "NativeEpg")

        // Atrás: primero cierra modales/paneles del HTML, luego vuelve a la
        // pestaña principal y solo entonces sale de la app.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("(window.handleBack && window.handleBack()) ? 'yes' : 'no'") { result ->
                    if (result?.contains("yes") != true) {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        if (isTvDevice(this)) {
            // Con control remoto el WebView debe tener el foco para recibir las flechas.
            webView.isFocusable = true
            webView.isFocusableInTouchMode = true
            webView.requestFocus()
        }
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onResume() {
        super.onResume()
        // Volviendo de "permitir instalar apps": continuar con la actualización.
        pendingApk?.let { f ->
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()) installApk(f)
        }
        if (pageLoaded) {
            deliverPendingAdds()
            webView.evaluateJavascript("window.onAppResume && window.onAppResume();", null)
        }
    }

    // Avisa a la interfaz cuando la app queda detrás (reproductor abierto, pantalla apagada):
    // así la precarga de catálogos no gasta datos mientras ves algo.
    override fun onPause() {
        if (pageLoaded) webView.evaluateJavascript("window.onAppPause && window.onAppPause();", null)
        super.onPause()
    }

    /** Pasa al HTML los items que el usuario añadió desde el reproductor. */
    private fun deliverPendingAdds() {
        val pending = PlayerActivity.takePendingAdds(this)
        for (i in 0 until pending.length()) {
            val o = pending.optJSONObject(i) ?: continue
            val name = JSONObject.quote(o.optString("name"))
            val url = JSONObject.quote(o.optString("url"))
            val cat = JSONObject.quote(o.optString("category"))
            webView.evaluateJavascript(
                "window.onNativeAddToList && window.onNativeAddToList($name,$url,$cat);",
                null
            )
        }
    }

    /**
     * Verifica si una URL de stream responde correctamente.
     * Intenta primero con HEAD (más liviano); si el servidor no lo soporta
     * (405/501, algo común en paneles Xtream), reintenta con GET + Range
     * para no descargar el stream completo.
     */
    private fun checkStreamUrl(urlStr: String): Boolean {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(urlStr)
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "HEAD"
            connection.connectTimeout = 6000
            connection.readTimeout = 6000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", "VLC/3.0.0")

            var code = connection.responseCode

            if (code == 405 || code == 501 || code == 400) {
                connection.disconnect()
                connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.connectTimeout = 6000
                connection.readTimeout = 6000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "VLC/3.0.0")
                connection.setRequestProperty("Range", "bytes=0-2048")
                code = connection.responseCode
            }

            code in 200..299
        } catch (e: Exception) {
            false
        } finally {
            connection?.disconnect()
        }
    }

    inner class NativeChecker {
        /**
         * No bloquea: dispara la verificación en un hilo del pool y, cuando
         * termina, llama de vuelta a window.onStreamChecked(id, online).
         */
        @JavascriptInterface
        fun checkStream(url: String, id: String) {
            val executor = checkExecutor
            if (executor.isShutdown) return
            try {
                executor.execute {
                    val online = checkStreamUrl(url)
                    if (executor.isShutdown) return@execute // ya se canceló esta tanda
                    runOnUiThread {
                        val safeId = JSONObject.quote(id)
                        webView.evaluateJavascript(
                            "window.onStreamChecked && window.onStreamChecked($safeId, $online);",
                            null
                        )
                    }
                }
            } catch (e: Exception) { /* pool cancelado mientras se encolaba */ }
        }

        /** Cancela las verificaciones pendientes (al cambiar de categoría o búsqueda). */
        @JavascriptInterface
        fun cancelAll() {
            val old = checkExecutor
            checkExecutor = Executors.newFixedThreadPool(6)
            old.shutdownNow()
        }
    }

    inner class NativePlayer {
        @JavascriptInterface
        fun play(payloadJson: String) {
            // La lista va en un archivo: una categoría grande supera el límite
            // de ~1 MB de un Intent y antes cerraba la app.
            val file = File(cacheDir, "player_payload.json")
            try { file.writeText(payloadJson) } catch (e: Exception) { }
            runOnUiThread {
                val intent = Intent(this@MainActivity, PlayerActivity::class.java)
                if (file.exists() && file.length() > 0) intent.putExtra(PlayerActivity.EXTRA_PAYLOAD_FILE, file.absolutePath)
                else intent.putExtra(PlayerActivity.EXTRA_PAYLOAD, payloadJson)
                startActivity(intent)
            }
        }
    }

    inner class NativeApp {
        /** Texto copiado en el teléfono (para detectar enlaces M3U). */
        @JavascriptInterface
        fun getClipboard(): String {
            return try {
                val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                val clip = cm.primaryClip
                if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this@MainActivity)?.toString() ?: "" else ""
            } catch (e: Exception) { "" }
        }

        /** Lista "Continuar viendo" que guarda el reproductor. */
        @JavascriptInterface
        fun getContinueWatching(): String = PlayerActivity.continueWatching(this@MainActivity)

        @JavascriptInterface
        fun getRecentLive(): String = PlayerActivity.recentLive(this@MainActivity)

        /** true en TV box / Android TV (se maneja con control remoto). */
        @JavascriptInterface
        fun isTv(): Boolean = isTvDevice(this@MainActivity)

        /** Inicia "Agregar desde el celular": devuelve {url, qr} o {error}. */
        @JavascriptInterface
        fun startRemoteAdd(): String {
            remoteServer?.stop()
            val srv = RemoteAddServer { items ->
                runOnUiThread {
                    webView.evaluateJavascript("window.onRemoteAdd && window.onRemoteAdd(${JSONObject.quote(items.toString())});", null)
                }
            }
            val url = try { srv.start() } catch (e: Exception) { "" }
            if (url.isEmpty()) return JSONObject().put("error", "No hay red WiFi o cableada. Conecta el equipo a la misma red que el celular.").toString()
            remoteServer = srv
            val qr = try { RemoteAddServer.qrPngBase64(url) } catch (e: Exception) { "" }
            return JSONObject().put("url", url).put("qr", qr).toString()
        }

        @JavascriptInterface
        fun stopRemoteAdd() { remoteServer?.stop(); remoteServer = null }

        /** Descarga el APK de una versión nueva y abre el instalador de Android. */
        @JavascriptInterface
        fun downloadUpdate(apkUrl: String, version: String) {
            Thread {
                try {
                    val dir = File(cacheDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                    val file = File(dir, "jox3-$version.apk")
                    var conn = URL(apkUrl).openConnection() as HttpURLConnection
                    conn.instanceFollowRedirects = true
                    conn.connectTimeout = 15000; conn.readTimeout = 30000
                    // GitHub redirige a otro dominio https; seguir hasta 5 saltos.
                    var hops = 0
                    while (conn.responseCode in 300..399 && hops < 5) {
                        val next = conn.getHeaderField("Location"); conn.disconnect()
                        conn = URL(URL(apkUrl), next).openConnection() as HttpURLConnection
                        conn.connectTimeout = 15000; conn.readTimeout = 30000; hops++
                    }
                    if (conn.responseCode !in 200..299) throw Exception("HTTP ${conn.responseCode}")
                    val total = conn.contentLengthLong
                    var done = 0L; var lastPct = -1
                    conn.inputStream.use { input -> file.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val r = input.read(buf); if (r < 0) break
                            out.write(buf, 0, r); done += r
                            val pct = if (total > 0) (done * 100 / total).toInt() else -1
                            if (pct != lastPct) { lastPct = pct; runOnUiThread { webView.evaluateJavascript("window.onUpdateProgress && window.onUpdateProgress($pct);", null) } }
                        }
                    } }
                    conn.disconnect()
                    runOnUiThread { installApk(file) }
                } catch (e: Exception) {
                    runOnUiThread { webView.evaluateJavascript("window.onUpdateError && window.onUpdateError(${JSONObject.quote(e.message ?: "error")});", null) }
                }
            }.start()
        }

        /** Lista de cuentas con su vencimiento para los avisos (days = 0 apaga los avisos). */
        @JavascriptInterface
        fun setExpiryWatch(json: String, days: Int) {
            try { ExpiryAlerts.configure(applicationContext, json, days) } catch (e: Exception) { }
        }

        /** Android 13+: pedir permiso para mostrar notificaciones. */
        @JavascriptInterface
        fun requestNotifications() {
            if (Build.VERSION.SDK_INT >= 33 && !ExpiryAlerts.canNotify(this@MainActivity)) {
                runOnUiThread { requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 77) }
            }
        }

        @JavascriptInterface
        fun lastCrash(): String = App.takeLastCrash(this@MainActivity)

        @JavascriptInterface
        fun appVersion(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (e: Exception) { "" }
    }

    /** Guía de internet para los canales que el servidor deja sin guía (ver ExternalEpg). */
    inner class NativeEpg {
        @JavascriptInterface
        fun ensure(codes: String) {
            ExternalEpg.ensure(this@MainActivity, codes.split(',')) {
                runOnUiThread { webView.evaluateJavascript("window.onExtEpgReady && window.onExtEpgReady();", null) }
            }
        }
        @JavascriptInterface
        fun lookupIn(name: String, tvgId: String, fromSec: Long, toSec: Long, country: String): String =
            try { ExternalEpg.lookupJson(this@MainActivity, name, tvgId, fromSec, toSec, country) } catch (e: Exception) { "" }
        @JavascriptInterface
        fun channels(): String = ExternalEpg.channelsJson()
        @JavascriptInterface
        fun setManual(name: String, key: String) = ExternalEpg.setManual(this@MainActivity, name, key)
        @JavascriptInterface
        fun status(): String = ExternalEpg.status()
    }

    inner class NativeFiles {
        @JavascriptInterface
        fun saveTextFile(content: String, fileName: String) {
            runOnUiThread {
                pendingFileContent = content
                try {
                    createDocument.launch(fileName)
                } catch (e: Exception) {
                    pendingFileContent = null
                    notifyJs("❌ No se pudo abrir el selector de archivos", "err")
                }
            }
        }
    }

    private fun writePendingFile(uri: Uri?) {
        val content = pendingFileContent
        pendingFileContent = null
        if (uri == null || content == null) return
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
            notifyJs("📥 Lista guardada", "ok")
        } catch (e: Exception) {
            notifyJs("❌ No se pudo guardar el archivo", "err")
        }
    }

    private fun notifyJs(message: String, type: String) {
        webView.evaluateJavascript(
            "window.toast && toast(${JSONObject.quote(message)}, ${JSONObject.quote(type)});",
            null
        )
    }

    /** Abre el instalador de Android con el APK descargado (pide permiso la primera vez). */
    private fun installApk(file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            pendingApk = file
            notifyJs("Permite instalar apps de JOX3 y vuelve atrás para continuar", "info")
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            } catch (e: Exception) { notifyJs("Activa 'Instalar apps desconocidas' para JOX3 en los ajustes", "err") }
            return
        }
        pendingApk = null
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try { startActivity(intent) } catch (e: Exception) { notifyJs("No se pudo abrir el instalador", "err") }
    }

    override fun onDestroy() {
        remoteServer?.stop()
        checkExecutor.shutdownNow()
        super.onDestroy()
    }
}
