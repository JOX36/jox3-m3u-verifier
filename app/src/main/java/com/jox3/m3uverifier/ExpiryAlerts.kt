package com.jox3.m3uverifier

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.util.concurrent.TimeUnit
import kotlin.math.floor

/**
 * Avisos de vencimiento de cuentas.
 *
 * La app le pasa a Android la lista de cuentas con su fecha de vencimiento. Un
 * revisor (WorkManager) corre cada 12 horas aunque la app esté cerrada y, si a
 * alguna cuenta le quedan N días o menos, muestra una notificación. Cada cuenta
 * se avisa una vez por cada día restante (5, 4, 3… hoy, vencida), sin repetir.
 */
object ExpiryAlerts {
    private const val PREFS = "jox3_expiry"
    private const val KEY_LIST = "list"
    private const val KEY_DAYS = "days"
    private const val KEY_SENT = "sent"
    private const val CHANNEL = "vencimientos"
    private const val WORK = "jox3_expiry_check"
    private const val NOTIF_ID = 4242

    fun configure(ctx: Context, json: String, days: Int) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_LIST, json).putInt(KEY_DAYS, days).apply()
        val wm = WorkManager.getInstance(ctx)
        if (days <= 0) { wm.cancelUniqueWork(WORK); return }
        wm.enqueueUniquePeriodicWork(
            WORK, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ExpiryWorker>(12, TimeUnit.HOURS).build()
        )
        // Revisión inmediata (no repite avisos ya enviados).
        wm.enqueue(OneTimeWorkRequestBuilder<ExpiryWorker>().build())
    }

    fun check(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val days = prefs.getInt(KEY_DAYS, 0)
        if (days <= 0) return
        val list = try { JSONArray(prefs.getString(KEY_LIST, "[]")) } catch (e: Exception) { JSONArray() }
        val sent = (prefs.getStringSet(KEY_SENT, emptySet()) ?: emptySet()).toMutableSet()
        val now = System.currentTimeMillis()
        val due = mutableListOf<Pair<String, Int>>()   // texto, días
        val newKeys = mutableListOf<String>()
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            val exp = o.optLong("exp", 0L) * 1000L
            if (exp <= 0) continue
            val left = floor((exp - now) / 86_400_000.0).toInt()
            if (left > days || left < -1) continue          // fuera del rango de aviso
            val key = "${o.optString("id")}|$left"
            if (key in sent) continue
            val when_ = when {
                left < 0 -> "venció"
                left == 0 -> "vence hoy"
                left == 1 -> "vence mañana"
                else -> "vence en $left días"
            }
            due += "${o.optString("name")} (${o.optString("server")}) $when_" to left
            newKeys += key
        }
        if (due.isEmpty()) return
        if (!canNotify(ctx)) return
        createChannel(ctx)
        due.sortBy { it.second }
        val title = if (due.size == 1) "Cuenta por vencer" else "${due.size} cuentas por vencer"
        val open = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val style = NotificationCompat.InboxStyle()
        due.take(6).forEach { style.addLine(it.first) }
        if (due.size > 6) style.setSummaryText("y ${due.size - 6} más")
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(due.first().first)
            .setStyle(style)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setColor(0xFF00D4FF.toInt())
            .build()
        try { NotificationManagerCompat.from(ctx).notify(NOTIF_ID, n) } catch (e: SecurityException) { return }
        // Recordar lo avisado (solo lo reciente, para que la lista no crezca sin fin).
        sent.addAll(newKeys)
        val keep = sent.toList().takeLast(400).toSet()
        prefs.edit().putStringSet(KEY_SENT, keep).apply()
    }

    fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun createChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Vencimiento de cuentas", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Avisa cuando a una cuenta IPTV le quedan pocos días"
                })
            }
        }
    }
}

class ExpiryWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        return try { ExpiryAlerts.check(applicationContext); Result.success() } catch (e: Exception) { Result.success() }
    }
}
