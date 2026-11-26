'use strict';
// JOX3 Verifier — Arranque de la app (va de último).

/* ═══════════════════════════ INICIO ═══════════════════════════ */
function migrate() {
  // Historial de la versión anterior → cuentas guardadas.
  if (store.get('jox3accounts', null)) return;
  const hist = store.get('jox3history', []);
  const accs = (Array.isArray(hist) ? hist : []).filter(h => h.host && h.username && h.password).map(h => ({
    id: makeId(h.host, h.username), host: h.host, username: h.username, password: h.password,
    status: h.status || '', expDate: h.expDate || '', catCount: { live: h.live || 0, vod: h.vod || 0, series: h.series || 0 },
    geo: h.geo ? { country: h.geo } : undefined, checkedAt: h.ts || 0,
  }));
  store.set('jox3accounts', accs);
}
function init() {
  migrate();
  S.cfg = store.get('jox3cfg', {}) || {};
  S.accounts = store.get('jox3accounts', []) || [];
  S.favs = store.get('jox3favs', {}) || {};
  const ml = store.get('jox3mylist', null);
  if (ml && Array.isArray(ml.items)) { S.myList = ml.items; S.thumbnails = Array.isArray(ml.thumbs) ? ml.thumbs : []; }
  S.onlineOnly = !!S.cfg.onlineOnly;
  if (S.cfg.skin) setSkin(S.cfg.skin);
  updateListBadge();
  const activeId = S.cfg.activeId && accountById(S.cfg.activeId) ? S.cfg.activeId : (S.accounts[0] && S.accounts[0].id);
  const first = S.accounts.length ? startTab() : 'home';
  S.tab = first;
  if (activeId) activateAccount(activeId).then(() => switchTab(first)); else switchTab('home');
  setTimeout(pushExpiryWatch, 2500);
  schedulePreload(PRE_FIRST);
  // Revisar si hay versión nueva (como mucho cada 12 horas).
  if (S.cfg.autoUpdate !== false && Date.now() - (S.cfg.lastUpdateCheck || 0) > 12 * 3600e3) setTimeout(() => checkUpdate(false), 4000);
  // Si la app se cerró por un error, mostrar qué pasó (para poder corregirlo).
  let crash = '';
  try { if (window.NativeApp && NativeApp.lastCrash) crash = NativeApp.lastCrash() || ''; } catch { }
  if (crash) {
    S.lastCrash = crash;
    setTimeout(() => showSheet('La app se cerró por un error', `
      <p class="confirm-txt">Ya volvió a abrir. Si te pasa de nuevo, copia este detalle y compártelo para corregirlo.</p>
      <pre class="crash">${esc(crash.split('\n').slice(0, 14).join('\n'))}</pre>
      <div class="list-actions confirm-actions"><button class="btn primary" onclick="copyText(S.lastCrash,'Detalle copiado')">${icon('copy')}Copiar detalle</button><button class="btn" onclick="closeTop()">Cerrar</button></div>`), 900);
  }
  // Recién actualizada: contar qué cambió.
  const pn = S.cfg.pendingNotes;
  if (pn && pn.ver) {
    if (buildNum(appVersion()) >= buildNum(pn.ver)) {
      delete S.cfg.pendingNotes; saveCfg();
      const notes = buildNum(appVersion()) === buildNum(pn.ver) ? releaseNotes(pn.notes) : [];
      if (notes.length) setTimeout(() => showSheet(`Ya tienes la versión ${pn.ver}`, `<div class="set-title" style="margin:0 0 8px">Novedades</div>${notesHtml(notes)}
        <div class="list-actions" style="margin-top:14px"><button class="btn primary block" onclick="closeTop()">Entendido</button></div>`), 1200);
    }
  }
}
// Al volver a la app: la guía de lo que están pasando se pone al día sola.
function refreshExpiredEpg() {
  const now = Date.now() / 1000;
  for (const sid of Object.keys(S.epg)) {
    const e = S.epg[sid];
    if (e && e.e && e.e < now) {
      delete S.epg[sid];
      document.querySelectorAll(`small.epg[data-sid="${CSS.escape(sid)}"]`).forEach(el => {
        el.textContent = ''; const bar = el.parentNode.querySelector('.p'); if (bar) bar.remove();
        epgQueue.push(sid);
      });
    } else if (e && e.s && e.e > e.s) {
      const pct = Math.round(Math.max(0, Math.min(100, (now - e.s) / (e.e - e.s) * 100)));
      e.pct = pct;
      document.querySelectorAll(`small.epg[data-sid="${CSS.escape(sid)}"]`).forEach(el => { const i = el.parentNode.querySelector('.p i'); if (i) i.style.width = pct + '%'; });
    }
  }
  pumpEpg();
  for (const sid of Object.keys(S.epgFull)) { const l = S.epgFull[sid]; if (l.length && l[l.length - 1].e < now + 3600) delete S.epgFull[sid]; }
  if ($('guide') && Date.now() / 1000 - G.start > 3600) renderGuide(); else placeNowLine();
}
// Botón "Recargar" de En vivo: vuelve a pedir canales, guía y estado de la categoría.
async function reloadLive() {
  const cat = S.view.live; if (!S.session || !cat || cat === '*') return;
  delete S.lists[`live:${cat}`]; await idb.set(`list:${S.session.id}:live:${cat}`, null);
  S.epg = {}; S.epgFull = {}; S.status = {}; S.epgOff = false;
  toast('Actualizando canales y guía…');
  loadLive(cat);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.tab === 'live' || S.tab === 'home') refreshExpiredEpg();
  if (S.tab === 'vod' || S.tab === 'series') renderContinue(S.tab);
  if (S.tab === 'home' || accountsOpen()) checkClipboardHint();
  if (S.tab === 'home') { renderHomeContinue(); renderHomeRecent(); }
});
init();
