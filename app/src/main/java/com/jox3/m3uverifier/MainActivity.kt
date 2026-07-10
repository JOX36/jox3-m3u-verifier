package com.jox3.m3uverifier

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // Pool de hilos para verificar canales en paralelo sin bloquear la UI.
    // 6 hilos es un límite razonable para no saturar la red del celular.
    private val checkExecutor: ExecutorService = Executors.newFixedThreadPool(6)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
        }

        webView.webChromeClient = WebChromeClient()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView, request: WebResourceRequest
            ) = false
        }

        // Puente JS -> Kotlin. Desde el HTML se llama como:
        // window.NativeChecker.checkStream(url, id)
        // Esto evita CORS por completo, porque la petición HTTP la hace
        // Kotlin (HttpURLConnection), no el navegador dentro del WebView.
        webView.addJavascriptInterface(NativeChecker(), "NativeChecker")

        // Puente JS -> Kotlin para el reproductor. Desde el HTML:
        // window.NativePlayer.play(url, titulo, categoria)
        // Abre PlayerActivity (ExoPlayer). Cuando el usuario toque "Añadir a
        // Mi Lista" ahí dentro, este callback le avisa al WebView.
        PlayerActivity.onAddToList = { name, url, category ->
            val safeName = JSONObject.quote(name)
            val safeUrl = JSONObject.quote(url)
            val safeCategory = JSONObject.quote(category)
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.onNativeAddToList && window.onNativeAddToList($safeName,$safeUrl,$safeCategory);",
                    null
                )
            }
        }
        webView.addJavascriptInterface(NativePlayer(), "NativePlayer")

        webView.loadUrl("file:///android_asset/index.html")
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
         * Llamado desde JavaScript. No bloquea: dispara la verificación en un
         * hilo del pool y, cuando termina, llama de vuelta a
         * window.onStreamChecked(id, online) dentro del WebView.
         */
        @JavascriptInterface
        fun checkStream(url: String, id: String) {
            checkExecutor.execute {
                val online = checkStreamUrl(url)
                runOnUiThread {
                    val safeId = JSONObject.quote(id) // evita romper el JS si el id trae caracteres raros
                    webView.evaluateJavascript(
                        "window.onStreamChecked && window.onStreamChecked($safeId, $online);",
                        null
                    )
                }
            }
        }
    }

    inner class NativePlayer {
        @JavascriptInterface
        fun play(payloadJson: String) {
            runOnUiThread {
                val intent = Intent(this@MainActivity, PlayerActivity::class.java)
                intent.putExtra("payload", payloadJson)
                startActivity(intent)
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        checkExecutor.shutdownNow()
        super.onDestroy()
    }
}
