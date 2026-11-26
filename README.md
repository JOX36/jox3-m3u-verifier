# JOX3 M3U Verifier

Verificador y editor de listas IPTV (Xtream Codes / M3U) para Android, con reproductor nativo.

## Funciones
- Verifica cuentas: estado, vencimiento, conexiones, ubicación del servidor.
- Explora y busca TV en vivo, películas y series, con verificación real de cada canal.
- **Mi Lista**: arma tu propia lista, se guarda en el teléfono, se exporta como `.m3u` o se envía por Telegram.

## Reproductor
- Pantalla completa real de borde a borde, también sobre el notch.
- Reconexión automática, mensajes de error claros e indicador de carga.
- Películas y series: barra de progreso, ±10 s, reanudar donde quedaste, siguiente episodio automático y velocidad.
- En vivo: EPG ahora/después con progreso, reloj y cambio de canal deslizando.
- Gestos: doble toque para ±10 s, deslizar a la izquierda para brillo y a la derecha para volumen, pellizcar para alternar "llenar pantalla" / "ver completo".
- Lista de canales/episodios, pistas de audio, subtítulos, calidad, apagado automático, bloqueo de pantalla e información técnica.
- Ventana flotante (PiP) con controles, y soporte para control remoto en Android TV.

## Compilar
GitHub Actions compila el APK en cada push a `main` (pestaña **Actions** → artefacto `JOX3-Verifier-APK`).

## Cómo está organizado
```
app/src/main/
├── assets/                 Interfaz (HTML/CSS/JS dentro de un WebView)
│   ├── index.html
│   ├── css/app.css
│   └── js/                 core → accounts → catalog → home → live → vod → search → mylist → settings → main, y tv.js
└── java/com/jox3/m3uverifier/
    ├── MainActivity.kt     WebView y puentes JS ↔ Android (NativeChecker, NativePlayer, NativeApp…)
    ├── App.kt, Device.kt   Registro de errores y detección de TV box
    ├── ExternalEpg.kt      Guía de internet para canales sin guía
    ├── ExpiryAlerts.kt     Avisos de vencimiento de cuentas
    ├── RemoteAddServer.kt  "Agregar desde el celular" (QR)
    └── player/             Reproductor nativo (ExoPlayer / Media3)
        ├── PlayerActivity.kt   estado y ciclo de vida
        ├── PlayerPlayback.kt   reproducción, formatos TS/HLS, errores, cambio de canal
        ├── PlayerUi.kt         controles, mensajes e indicadores
        ├── PlayerInput.kt      gestos, ajuste de imagen, control remoto
        ├── PlayerPanels.kt     lista de canales y ajustes
        ├── PlayerTracks.kt     audio, subtítulos, calidad
        ├── PlayerEpg.kt        guía ahora / después
        ├── PlayerPip.kt        ventana flotante
        ├── PlayerCast.kt, CastSupport.kt   Chromecast
        └── PlayerStorage.kt    reanudar, continuar viendo, recientes
```

## Tecnología
Kotlin 2.2 · Android Gradle Plugin 8.13 · Gradle 8.14 · compileSdk 36 / targetSdk 35 · minSdk 21 (Android 5) ·
Media3 1.8 + decodificador FFmpeg de Jellyfin (deben ir en la misma versión).
