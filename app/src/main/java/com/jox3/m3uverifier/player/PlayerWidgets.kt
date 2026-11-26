@file:OptIn(UnstableApi::class)

package com.jox3.m3uverifier.player

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.jox3.m3uverifier.R
import kotlin.math.roundToInt

// Piezas de interfaz reutilizables: botones, etiquetas, fuentes y medidas.

// ═══════════════════════════════════════════════════════════════════
// AYUDAS DE INTERFAZ
// ═══════════════════════════════════════════════════════════════════

internal fun PlayerActivity.loadFont(name: String, style: Int): Typeface =
    try { Typeface.createFromAsset(assets, "fonts/$name") } catch (e: Exception) { Typeface.create(Typeface.DEFAULT, style) }

internal fun PlayerActivity.applyFonts(v: View) {
    if (v is TextView) {
        val bold = ((v.typeface?.style ?: 0) and Typeface.BOLD) != 0
        v.typeface = if (bold) fontBold else fontRegular
    }
    if (v is ViewGroup) for (i in 0 until v.childCount) applyFonts(v.getChildAt(i))
}

internal fun PlayerActivity.dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()
internal fun PlayerActivity.wrap() = ViewGroup.LayoutParams.WRAP_CONTENT
internal fun PlayerActivity.matchParent() = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
internal fun PlayerActivity.spacer(widthDp: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(widthDp), 1) }

internal fun PlayerActivity.rounded(color: Int, radius: Float) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = radius
}

internal fun PlayerActivity.circleButton(icon: Int, sizeDp: Int, padDp: Int, bg: Int, description: String, onClick: () -> Unit): ImageView {
    return ImageView(this).apply {
        setImageResource(icon)
        contentDescription = description
        val circle = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(bg) }
        val mask = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) }
        val normal = RippleDrawable(ColorStateList.valueOf(Color.parseColor("#55FFFFFF")), circle, mask)
        val focused = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(if (bg == accent) accent else Color.parseColor("#AA0b1e30"))
            setStroke(dp(3), if (bg == accent) Color.WHITE else accent)
        }
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), focused)
            addState(intArrayOf(), normal)
        }
        setPadding(dp(padDp), dp(padDp), dp(padDp), dp(padDp))
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
        isFocusable = true
        setOnFocusChangeListener { v, has -> v.animate().scaleX(if (has) 1.12f else 1f).scaleY(if (has) 1.12f else 1f).setDuration(120).start() }
        setOnClickListener {
            onClick()
            if (controlsVisible) scheduleHideControls()
        }
    }
}

internal fun PlayerActivity.pill(text: String, textColor: Int, bg: Int) = TextView(this).apply {
    this.text = text
    setTextColor(textColor)
    textSize = 11f
    setTypeface(typeface, Typeface.BOLD)
    letterSpacing = 0.06f
    background = rounded(bg, dp(6).toFloat())
    setPadding(dp(8), dp(3), dp(8), dp(3))
}

internal fun PlayerActivity.textButton(bg: Int, fg: Int) = TextView(this).apply {
    setTextColor(fg)
    textSize = 14f
    setTypeface(typeface, Typeface.BOLD)
    gravity = Gravity.CENTER
    val shape = rounded(bg, dp(22).toFloat())
    val mask = rounded(Color.WHITE, dp(22).toFloat())
    val focused = rounded(bg, dp(22).toFloat()).apply { setStroke(dp(3), if (bg == accent) Color.WHITE else accent) }
    background = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), focused)
        addState(intArrayOf(), RippleDrawable(ColorStateList.valueOf(Color.parseColor("#55FFFFFF")), shape, mask))
    }
    setPadding(dp(20), dp(11), dp(20), dp(11))
    isFocusable = true
}

/** Adaptador simple para las listas del panel lateral (sin dependencias extra). */
internal class RowAdapter(private val a: PlayerActivity) : BaseAdapter() {
    var rows: List<Row> = emptyList()
        set(value) { field = value; notifyDataSetChanged() }

    override fun getCount() = rows.size
    override fun getItem(position: Int): Any = rows[position]
    override fun getItemId(position: Int) = position.toLong()

    override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
        val view = (convertView as? LinearLayout) ?: createRowView().also { a.applyFonts(it) }
        val bar = view.getChildAt(0)
        val texts = view.getChildAt(1) as LinearLayout
        val title = texts.getChildAt(0) as TextView
        val subtitle = texts.getChildAt(1) as TextView
        val row = rows[position]
        title.text = row.title
        title.setTextColor(if (row.selected) a.accent else Color.WHITE)
        title.typeface = if (row.selected) a.fontBold else a.fontRegular
        subtitle.text = row.subtitle ?: ""
        subtitle.visibility = if (row.subtitle.isNullOrEmpty()) View.GONE else View.VISIBLE
        bar.visibility = if (row.selected) View.VISIBLE else View.INVISIBLE
        view.alpha = if (row.action == null) 0.75f else 1f
        return view
    }

    private fun createRowView(): LinearLayout {
        val rowView = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = a.dp(52)
            setPadding(a.dp(8), a.dp(8), a.dp(16), a.dp(8))
        }
        val bar = View(a).apply { setBackgroundColor(a.accent) }
        rowView.addView(bar, LinearLayout.LayoutParams(a.dp(3), a.dp(28)).apply { marginEnd = a.dp(13) })
        val texts = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        val title = TextView(a).apply {
            textSize = 15f
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        val subtitle = TextView(a).apply {
            textSize = 12f
            setTextColor(a.muted)
            maxLines = 2
        }
        texts.addView(title)
        texts.addView(subtitle)
        rowView.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        return rowView
    }
}
