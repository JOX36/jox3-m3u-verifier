package com.jox3.m3uverifier

/** Detecta TV box / Android TV: modo TV del sistema o equipo sin pantalla táctil. */
fun isTvDevice(ctx: android.content.Context): Boolean {
    val ui = ctx.getSystemService(android.content.Context.UI_MODE_SERVICE) as? android.app.UiModeManager
    if (ui?.currentModeType == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION) return true
    val pm = ctx.packageManager
    return pm.hasSystemFeature("android.software.leanback") ||
        !pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_TOUCHSCREEN)
}
