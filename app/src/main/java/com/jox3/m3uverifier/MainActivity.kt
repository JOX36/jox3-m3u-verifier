package com.jox3.m3uverifier

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
        if (pageLoaded) deliverPendingAdds()
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

        /** true en TV box / Android TV (se maneja con control remoto). */
        @JavascriptInterface
        fun isTv(): Boolean = isTvDevice(this@MainActivity)

        @JavascriptInterface
        fun appVersion(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (e: Exception) { "" }
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

    override fun onDestroy() {
        checkExecutor.shutdownNow()
        super.onDestroy()
    }
}
