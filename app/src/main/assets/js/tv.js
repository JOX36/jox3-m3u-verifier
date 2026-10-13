'use strict';
/* ════════════════════════════════════════════════════════════════
   Navegación con control remoto (TV box / Android TV)
   Flechas = moverse al elemento más cercano en esa dirección.
   OK = tocar. Atrás = lo maneja Android (window.handleBack).
   Se activa sola en TV; en el teléfono no cambia nada.
   ════════════════════════════════════════════════════════════════ */
(function () {
  let tv = !!window.IS_TV;
  try { tv = tv || !!(window.NativeApp && NativeApp.isTv && NativeApp.isTv()); } catch { }
  if (/[?&]tv=1\b/.test(location.search)) tv = true;
  window.IS_TV = tv;

  const SEL = 'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea, summary';
  let lastRect = null;

  function enable() {
    document.body.classList.add('tv');
    // Filas que son <div onclick> se vuelven enfocables.
    const mark = root => root.querySelectorAll('[onclick]:not(button):not(input):not(select):not(summary):not([tabindex])').forEach(el => {
      if (el.id === 'scrim') return;
      el.tabIndex = 0; el.setAttribute('role', 'button');
    });
    mark(document);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('[onclick]:not(button)') && n.id !== 'scrim' && !n.hasAttribute('tabindex')) { n.tabIndex = 0; n.setAttribute('role', 'button'); } mark(n); } })))
      .observe(document.body, { childList: true, subtree: true });

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', e => { lastRect = e.target.getBoundingClientRect(); });
    setTimeout(() => focusFirst(), 600);
  }

  // Capa activa: hoja abierta, pantalla superpuesta o la app principal.
  function layer() {
    const st = (typeof S !== 'undefined' && S.stack) || [];
    const top = st[st.length - 1];
    if (!top) return document.getElementById('app');
    return top.kind === 'sheet' ? document.getElementById('sheet') : document.getElementById(top.id);
  }
  function visible(el) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // descartar lo que está dentro de un contenedor plegado o escondido
    return !el.closest('[hidden], .more, details:not([open]) > :not(summary)');
  }
  function candidates(root) { return [...root.querySelectorAll(SEL)].filter(visible); }

  function focusEl(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    lastRect = el.getBoundingClientRect();
  }
  // Primer elemento útil de la capa (lo seleccionado si existe).
  function focusFirst(root = layer()) {
    if (root.id === 'page-search') { const inp = document.getElementById('search-input'); if (inp) { focusEl(inp); return; } }
    const pref = root.querySelector('.chip.on, .nav button.on, .seg button.on');
    const list = candidates(root);
    const inView = list.filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    const pick = root === document.getElementById('app') ? (inView.find(el => el.closest('main')) || pref) : (inView[0] || list[0]);
    focusEl(pick || list[0]);
  }
  window.tvFocusFirst = focusFirst;

  // El más cercano en una dirección: primero lo que está alineado, luego la distancia.
  function move(dir) {
    const root = layer();
    let cur = document.activeElement;
    if (!cur || cur === document.body || !root.contains(cur) || !visible(cur)) {
      // Se perdió el foco (la lista se volvió a dibujar): retomar cerca de donde estaba.
      const list = candidates(root);
      if (!list.length) return;
      if (lastRect) {
        const cx = lastRect.left + lastRect.width / 2, cy = lastRect.top + lastRect.height / 2;
        let best = null, bd = Infinity;
        for (const el of list) { const r = el.getBoundingClientRect(); const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy); if (d < bd) { bd = d; best = el; } }
        focusEl(best);
      } else focusFirst(root);
      return;
    }
    // Fila con botones adentro (★, ⋮): derecha entra a ellos; izquierda desde ellos vuelve a la fila.
    if (dir === 'right') {
      const inner = candidates(cur).filter(x => x !== cur);
      if (inner.length) { focusEl(inner[0]); return; }
    }
    const parentRow = cur.parentElement && cur.parentElement.closest('[tabindex="0"]');
    const a = cur.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const el of candidates(root)) {
      if (el === cur || el.contains(cur) || cur.contains(el)) continue;
      const b = el.getBoundingClientRect();
      let gap, cross;
      if (dir === 'down') { gap = b.top - a.bottom; cross = overlap(a.left, a.right, b.left, b.right); }
      else if (dir === 'up') { gap = a.top - b.bottom; cross = overlap(a.left, a.right, b.left, b.right); }
      else if (dir === 'right') { gap = b.left - a.right; cross = overlap(a.top, a.bottom, b.top, b.bottom); }
      else { gap = a.left - b.right; cross = overlap(a.top, a.bottom, b.top, b.bottom); }
      if (gap < -Math.min(a.height, a.width, b.height, b.width) * 0.5) continue;   // está detrás, no adelante
      let score = Math.max(gap, 0) + cross * 2.5;
      // Preferir quedarse en la misma zona (lista, rejilla, barra) antes que saltar a otra.
      if (zone(el) !== zone(cur)) score += 600;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (dir === 'left' && parentRow && (!best || !parentRow.contains(best))) { focusEl(parentRow); return; }
    if (best) focusEl(best);
    else if (dir === 'up' || dir === 'down') {
      // Sin más elementos: desplazar el contenedor (por si hay más contenido por cargar).
      const sc = cur.closest('.scroll, .page.detail, .sh-body');
      if (sc) sc.scrollBy({ top: dir === 'down' ? 240 : -240 });
    }
  }
  function zone(el) { return el.closest('.grid, .nav, .chips, .seasons, .appbar, .sh-body, .scroll, .page') || document.body; }
  function overlap(a1, a2, b1, b2) {
    // 0 si se cruzan en el eje perpendicular; si no, la distancia entre ellos.
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  function onKey(e) {
    const dir = KEYS[e.key];
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    if (dir) {
      if (typing) {
        // En un campo de texto, izquierda/derecha mueven el cursor hasta llegar al borde.
        const v = el.value || '', s = el.selectionStart ?? 0, en = el.selectionEnd ?? 0;
        if (dir === 'left' && s > 0) return;
        if (dir === 'right' && en < v.length) return;
        if (el.tagName === 'TEXTAREA' && (dir === 'up' || dir === 'down') && v.includes('\n')) return;
      }
      if (el && el.tagName === 'SELECT' && (dir === 'up' || dir === 'down') && e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      move(dir);
      return;
    }
    if (e.key === 'Enter' && el && el !== document.body) {
      // OK del control sobre filas que no son botones.
      if (!['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'A'].includes(el.tagName)) { e.preventDefault(); el.click(); }
    }
  }

  // Al abrir o cerrar capas: enfocar dentro de la nueva y volver al anterior al cerrar.
  function hookLayers() {
    const sp = window.showPage, ss = window.showSheet, ct = window.closeTop;
    if (!sp || !ss || !ct) return;
    const prev = [];
    window.showPage = function (id) { const had = S.stack.some(l => l.id === id); if (!had) prev.push(document.activeElement); sp.apply(this, arguments); setTimeout(() => focusFirst(document.getElementById(id)), 320); };
    window.showSheet = function () { const had = S.stack.some(l => l.kind === 'sheet'); if (!had) prev.push(document.activeElement); ss.apply(this, arguments); setTimeout(() => focusFirst(document.getElementById('sheet')), 320); };
    window.closeTop = function () {
      const r = ct.apply(this, arguments);
      const back = prev.pop();
      setTimeout(() => { if (back && document.contains(back) && visible(back)) focusEl(back); else focusFirst(layer()); }, 280);
      return r;
    };
  }

  if (tv) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { enable(); hookLayers(); });
    else { enable(); hookLayers(); }
  }
})();
