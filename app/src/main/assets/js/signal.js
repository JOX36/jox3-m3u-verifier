'use strict';
// JOX3 Verifier — Mejor señal: compara un canal en vivo entre todas tus cuentas y lo ordena por fluidez.

/* ═══════════════════════════ MEJOR SEÑAL ═══════════════════════════ */
// 1. Busca el mismo canal en cada cuenta activa ("CO: Caracol HD" = "CARACOL TV FHD" = "Caracol ᴿᴬᵂ").
// 2. Prueba cada opción de verdad, una a la vez (Kotlin: SignalProbe): unos segundos de video sin mostrarlo.
// 3. Las ordena de mejor a peor por arranque, fluidez y cortes. La resolución no cuenta.
const SIG = { gen: 0, running: false, name: '', key: '', epgId: '', cands: [], tested: [], queue: [], cur: null, errors: [], savedTs: 0, meteredOk: false };
const SIG_SECONDS = 8;   // lo que tarda en promedio cada prueba (para calcular el tiempo)
const SIG_STOP = new Set('hd fhd uhd 4k 8k sd hq lq hevc h265 h264 x265 x264 1080p 720p 480p 1080 720 576 50fps 60fps fps raw vip backup bk alt tv canal television channel'.split(' '));

// Nombre "puro" del canal, sin país, calidad, símbolos ni etiquetas: lo que se compara entre cuentas.
function sigKey(name) {
  let s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[\[(][^\])]{0,24}[\])]/g, ' ');                       // [CO] (Backup) (720p)
  const pre = s.match(/^\s*([a-z]{2,6})\s*[|:»•\-–]+\s*/);               // "co: ", "latam | "
  if (pre && (CAT_CODES.has(pre[1].toUpperCase()) || pre[1] === 'latam')) s = s.slice(pre[0].length);
  let t = s.replace(/[^a-z0-9+]+/g, ' ').trim().split(' ').filter(Boolean);
  if (t.length > 1 && CAT_CODES.has(t[0].toUpperCase())) t = t.slice(1);   // "CO Caracol"
  t = t.filter(w => !SIG_STOP.has(w));
  return t.join(' ');
}
// 2 = mismo canal, 1 = parecido (p. ej. "Caracol Internacional" al buscar "Caracol"), 0 = otro.
function sigMatch(ch) {
  const k = sigKey(itemName(ch));
  if (k && k === SIG.key) return 2;
  if (SIG.epgId && ch.epg_channel_id && String(ch.epg_channel_id).toLowerCase() === SIG.epgId) return 2;
  if (!k || SIG.key.length < 3) return 0;
  const a = SIG.key.split(' '), b = k.split(' '), as = new Set(a), bs = new Set(b);
  return a.every(w => bs.has(w)) || b.every(w => as.has(w)) ? 1 : 0;
}

// Desde la tarjeta de un canal en vivo.
function openBestSignal(i) {
  const it = S.rendered.live[i]; if (!it) return;
  if (!window.NativeSignal) { toast('La prueba de señal solo funciona en la app instalada', 'err'); return; }
  sigOpen(itemName(it), it.epg_channel_id || '');
}
async function sigOpen(name, epgId) {
  sigCancel();
  const gen = SIG.gen;
  Object.assign(SIG, { name, key: sigKey(name) || normTxt(name), epgId: String(epgId || '').toLowerCase(), cands: [], tested: [], queue: [], cur: null, errors: [], savedTs: 0 });
  $('signal-title').textContent = cleanTitle(name);
  showPage('page-signal');
  const body = $('signal-body');
  const accs = usableAccounts();
  if (!accs.length) { body.innerHTML = emptyState('acc', 'No hay cuentas activas', 'Verifica tus cuentas para poder comparar.'); return; }
  const seen = new Set();
  for (let n = 0; n < accs.length; n++) {
    const acc = accs[n];
    body.innerHTML = loadingHtml(`Buscando “${cleanTitle(name)}” en ${serverName(acc)} (${n + 1} de ${accs.length})…`);
    try {
      const all = await getListFor(acc, 'live');
      if (parentalLocked()) await loadAccCats(acc.id);
      if (gen !== SIG.gen) return;
      const sess = sessionFor(acc.id);
      for (const ch of filterAllowed('live', all, acc.id)) {
        const m = sigMatch(ch); if (!m) continue;
        const url = streamUrl('live', ch, sess);
        if (seen.has(url)) continue; seen.add(url);
        SIG.cands.push({ id: 'c' + SIG.cands.length, acc, ch, url, apiUrl: sess.apiUrl, exact: m === 2, on: m === 2, res: null, score: 0 });
      }
    } catch (e) { SIG.errors.push(`${serverName(acc)}: ${e.message}`); }
    if (gen !== SIG.gen) return;
  }
  // Si ya se probó hace poco, se muestra ese resultado directo (con opción de repetir).
  const prev = sigSaved()[SIG.key];
  if (prev && Date.now() - prev.ts < 30 * 60e3 && sigLoadSaved(prev)) return;
  renderSigPick();
}

/* ─── Elegir qué opciones probar ─── */
function renderSigPick() {
  const body = $('signal-body'); if (!body) return;
  const exact = SIG.cands.filter(c => c.exact), similar = SIG.cands.filter(c => !c.exact);
  const errs = SIG.errors.length ? `<div class="hint" style="color:var(--warn);margin:10px 0">No se pudo buscar en: ${esc(SIG.errors.join(' · '))}</div>` : '';
  if (!SIG.cands.length) {
    body.innerHTML = emptyState('search', 'No lo encontré en otras cuentas', `Busqué “${cleanTitle(SIG.name)}” en tus ${usableAccounts().length} cuentas activas.`) + errs;
    return;
  }
  const accN = new Set(SIG.cands.map(c => c.acc.id)).size;
  const prev = sigSaved()[SIG.key];
  let metered = false; try { metered = !!(NativeSignal.isMetered && NativeSignal.isMetered()); } catch { }
  body.innerHTML = `
    <p class="sig-lead">Encontré <b>${exact.length}</b> ${exact.length === 1 ? 'opción' : 'opciones'} de este canal en <b>${accN}</b> ${accN === 1 ? 'cuenta' : 'cuentas'}${similar.length ? ` y ${similar.length} ${similar.length === 1 ? 'parecida' : 'parecidas'}` : ''}. Marca las que quieres probar.</p>
    ${prev ? `<button class="btn sm" style="margin-bottom:10px" onclick="sigLoadSaved(sigSaved()[SIG.key])">${icon('history')}Ver la prueba de ${esc(sigAgo(prev.ts))}</button>` : ''}
    ${metered ? `<div class="hint" style="color:var(--warn);margin-bottom:10px">Estás con datos móviles: cada prueba gasta unos 2–10 MB.</div>` : ''}
    ${exact.length ? `<h3 class="srv-type">Mismo canal</h3>${exact.map(sigPickRow).join('')}` : ''}
    ${similar.length ? `<details class="sig-similar"${exact.length ? '' : ' open'}><summary>Parecidos (${similar.length}) ${icon('down', 'chev')}</summary>${similar.map(sigPickRow).join('')}</details>` : ''}
    ${errs}
    <div class="sig-foot"><button class="btn primary block" id="sig-go" onclick="sigRun()"></button></div>`;
  sigUpdateGo();
}
function sigPickRow(c) {
  const name = itemName(c.ch);
  return `<label class="ch sig-pick">
    <input type="checkbox" ${c.on ? 'checked' : ''} onchange="sigToggle('${c.id}',this.checked)">
    ${logoHtml(name, c.ch.stream_icon)}
    <span class="n"><b>${esc(name)}</b><small>${esc(serverName(c.acc))} · ${esc(c.acc.username)}</small></span>
  </label>`;
}
function sigToggle(id, on) { const c = SIG.cands.find(x => x.id === id); if (c) c.on = on; sigUpdateGo(); }
function sigUpdateGo() {
  const b = $('sig-go'); if (!b) return;
  const n = SIG.cands.filter(c => c.on).length;
  b.disabled = !n;
  b.innerHTML = n ? `${icon('play')}Probar ${n} ${n === 1 ? 'opción' : 'opciones'} · ${sigEta(n)}` : 'Marca al menos una opción';
}
function sigEta(n) { const s = n * SIG_SECONDS; return s < 60 ? `${s} s` : `~${Math.round(s / 60)} min`; }

/* ─── Probar, una opción a la vez ─── */
function sigRun() {
  const sel = SIG.cands.filter(c => c.on);
  if (!sel.length) { toast('Marca al menos una opción'); return; }
  let metered = false; try { metered = !!(NativeSignal.isMetered && NativeSignal.isMetered()); } catch { }
  if (metered && !SIG.meteredOk) {
    askConfirm('Estás con datos móviles', `Probar ${sel.length} ${sel.length === 1 ? 'opción gasta' : 'opciones gasta'} hasta unos ${sel.length * 10} MB. ¿Seguir?`, 'Probar', () => { SIG.meteredOk = true; sigRun(); }, false);
    return;
  }
  sigCancel();
  stopChecks();   // que la verificación de la lista no compita por tu internet
  sel.forEach(c => { c.res = null; c.score = 0; });
  Object.assign(SIG, { tested: sel, queue: sel.slice(), cur: null, running: true, savedTs: 0 });
  renderSigRun();
  sigNext();
}
function sigNext() {
  if (!SIG.running) return;
  const c = SIG.queue.shift();
  if (!c) { sigFinish(false); return; }
  SIG.cur = c;
  renderSigRun();
  try { NativeSignal.test(c.url, `${SIG.gen}:${c.id}`); } catch (e) { c.res = { ok: false, error: 'No se pudo probar' }; SIG.cur = null; setTimeout(sigNext, 100); }
}
window.onSignalResult = function (id, r) {
  const [g, cid] = String(id).split(':');
  if (+g !== SIG.gen || !SIG.running) return;
  const c = SIG.cands.find(x => x.id === cid); if (!c || (r && r.cancelled)) return;
  c.res = r || { ok: false, error: 'Sin respuesta' };
  c.score = sigScore(c.res);
  SIG.cur = null;
  renderSigRun();
  setTimeout(sigNext, 400);
};
// Detiene todo (al salir de la pantalla o empezar otra prueba). Las respuestas que lleguen tarde se ignoran.
function sigCancel() {
  SIG.gen++; SIG.running = false; SIG.queue = []; SIG.cur = null;
  try { if (window.NativeSignal) NativeSignal.cancelAll(); } catch { }
}
function sigStop() { sigCancel(); sigFinish(true); }
function sigFinish(stopped) {
  SIG.running = false; SIG.cur = null;
  const tested = SIG.tested.filter(c => c.res);
  if (tested.length) sigSave(tested);
  renderSigRun();
  if (!stopped) {
    const best = sigRanked().find(c => c.res && c.res.ok);
    toast(best ? `Mejor señal: ${serverName(best.acc)} · ${best.score}/100` : 'Ninguna opción respondió', best ? 'ok' : 'err');
  }
}

/* ─── Puntaje (0–100) ─── */
// Fluidez 45 %: segundos de video que llegan por cada segundo (TS: 1,35× ya es excelente; HLS baja segmentos
//   completos a toda velocidad, así que se le pide más: 3×). Arranque 30 %: de 0,4 s (perfecto) a 5 s.
// Estabilidad 25 %: TS = pausa más larga sin datos; HLS = el segmento que peor bajó.
function sigScore(r) {
  if (!r || !r.ok) return 0;
  const cl = v => Math.max(0, Math.min(1, v));
  const hls = r.kind === 'HLS';
  const flu = r.ratio == null ? 0.5 : cl((r.ratio - 0.85) / ((hls ? 3 : 1.35) - 0.85));
  const arr = cl(1 - ((r.startMs > 0 ? r.startMs : 5000) - 400) / (5000 - 400));
  let est = hls ? (r.minRatio == null ? 0.5 : cl((r.minRatio - 0.9) / (2 - 0.9)))
    : cl(1 - ((r.maxGapMs || 0) - 600) / (3000 - 600));
  if (r.stalls > 2) est *= 0.6;
  return Math.round(100 * (0.45 * flu + 0.30 * arr + 0.25 * est));
}
function sigLevel(s) {
  if (s >= 80) return { cls: 'great', label: 'Excelente' };
  if (s >= 60) return { cls: 'good', label: 'Buena' };
  if (s >= 40) return { cls: 'fair', label: 'Regular' };
  return { cls: 'poor', label: 'Mala' };
}
const sigNum = (v, d = 1) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });
function sigDetail(r) {
  const p = [];
  if (r.startMs > 0) p.push(`Arranca en ${sigNum(r.startMs / 1000)} s`);
  if (r.ratio != null) p.push(`Fluidez ${sigNum(r.ratio)}×`);
  p.push(r.stalls ? `${r.stalls} ${r.stalls === 1 ? 'corte' : 'cortes'}` : 'Sin cortes');
  if (r.kbps > 0) p.push(`${sigNum(r.kbps / 1000)} Mbps`);
  if (r.resolution) p.push(r.resolution.split('x')[1] + 'p');
  return p.join(' · ');
}
// Primero las que funcionaron (mejor puntaje arriba), luego las caídas y al final las que faltan.
function sigRanked() {
  const order = c => !c.res ? 2 : c.res.ok ? 0 : 1;
  return SIG.tested.slice().sort((a, b) => order(a) - order(b) || b.score - a.score || (a.res && b.res ? (a.res.startMs || 0) - (b.res.startMs || 0) : 0));
}

/* ─── Resultados ─── */
function renderSigRun() {
  const body = $('signal-body'); if (!body) return;
  const list = sigRanked(), total = SIG.tested.length, done = SIG.tested.filter(c => c.res).length;
  let head;
  if (SIG.running) {
    head = `<div class="sig-prog">
      <div class="sig-prog-t"><span class="spinner"></span><span>Probando ${Math.min(done + 1, total)} de ${total}${SIG.cur ? ` · ${esc(serverName(SIG.cur.acc))}` : ''}<small>Faltan ${sigEta(total - done)}</small></span></div>
      <div class="sig-bar"><i style="width:${Math.round(done / total * 100)}%"></i></div>
      <button class="btn sm" onclick="sigStop()">${icon('close')}Detener</button></div>`;
  } else {
    const okN = SIG.tested.filter(c => c.res && c.res.ok).length;
    head = `<div class="sig-prog done">
      <div class="sig-prog-t">${icon('check')}<span>${okN} de ${done} con señal<small>Probado ${esc(SIG.savedTs ? sigAgo(SIG.savedTs) : 'ahora')}. Toca una opción para verla.</small></span></div>
      <div class="sig-actions"><button class="btn sm primary" onclick="sigRun()">${icon('refresh')}Probar de nuevo</button><button class="btn sm" onclick="renderSigPick()">Cambiar opciones</button></div></div>`;
  }
  let rank = 0;
  const rows = list.map(c => sigRowHtml(c, c.res && c.res.ok ? ++rank : 0)).join('');
  body.innerHTML = head + rows + `<p class="hint" style="margin:14px 2px">Puntaje: fluidez 45 %, arranque 30 %, estabilidad 25 %. Fluidez 2× = llegan 2 segundos de video por cada segundo de espera; menos de 1× se congela. La resolución no cuenta. El resultado cambia según la hora y tu internet.</p>`;
}
function sigRowHtml(c, rank) {
  const r = c.res, name = itemName(c.ch), testing = c === SIG.cur;
  let cls, score, detail;
  if (!r) { cls = testing ? 'testing' : 'pending'; score = testing ? '<span class="spinner"></span>' : ''; detail = testing ? 'Probando…' : 'En espera'; }
  else if (!r.ok) { cls = 'bad'; score = '—'; detail = `Sin señal: ${r.error || 'no respondió'}`; }
  else { const lv = sigLevel(c.score); cls = lv.cls; score = `${c.score}<small>${lv.label}</small>`; detail = sigDetail(r); }
  const ok = r && r.ok;
  return `<div class="ch sig-row ${cls}"${ok ? ` onclick="sigPlay('${c.id}')"` : ''}>
    <span class="sig-rank">${rank || ''}</span>
    ${logoHtml(name, c.ch.stream_icon)}
    <span class="n"><b>${esc(name)}</b><small>${esc(serverName(c.acc))} · ${esc(c.acc.username)}${r && r.kind ? ' · ' + r.kind : ''}</small><small class="sig-d">${esc(detail)}</small>${ok ? `<span class="sig-meter"><i style="width:${c.score}%"></i></span>` : ''}</span>
    <span class="sig-score">${score}</span>
    ${ok ? `<button class="fav" onclick="event.stopPropagation();sigMenu('${c.id}')" aria-label="Más opciones">${icon('more')}</button>` : ''}
  </div>`;
}
// Reproduce la opción elegida. Las demás que funcionaron van detrás, en orden: siguiente canal = siguiente mejor señal.
function sigPlay(id) {
  const ok = sigRanked().filter(c => c.res && c.res.ok);
  const i = ok.findIndex(c => c.id === id); if (i < 0) return;
  nativePlay(ok.map(c => ({
    name: `${cleanTitle(itemName(c.ch))} · ${serverName(c.acc)}`, url: c.url, streamId: String(c.ch.stream_id), isLive: true,
    poster: c.ch.stream_icon || '', epgId: c.ch.epg_channel_id || '', apiUrl: c.apiUrl,
  })), i, `Mejor señal · ${cleanTitle(SIG.name)}`, ok[i].apiUrl);
}
function sigMenu(id) {
  const c = SIG.cands.find(x => x.id === id); if (!c) return;
  showSheet(`${itemName(c.ch)} · ${serverName(c.acc)}`, `
    <button class="menu-item" onclick="closeTop();sigPlay('${c.id}')">${icon('play')}Reproducir</button>
    <button class="menu-item" onclick="closeTop();copyText(${jsArg(c.url)},'Enlace copiado')">${icon('copy')}Copiar enlace</button>
    <button class="menu-item" onclick="closeTop();sigAddToList('${c.id}')">${icon('list')}Añadir a Mi lista</button>
    <p class="hint" style="margin-top:10px">El enlace funciona en cualquier reproductor (VLC, otra app de IPTV…). Lleva el usuario y la contraseña de la cuenta ${esc(c.acc.username)}: compártelo solo con quien confíes.</p>`);
}
function sigAddToList(id) {
  const c = SIG.cands.find(x => x.id === id); if (!c) return;
  addToList({ name: `${cleanTitle(itemName(c.ch))} (mejor señal · ${serverName(c.acc)})`, url: c.url, category: 'TV en Vivo', synopsis: '', thumbnail: c.ch.stream_icon || '' });
}

/* ─── Guardar la última prueba de cada canal ─── */
function sigSaved() { return store.get('jox3signal', {}) || {}; }
function sigSave(tested) {
  const all = sigSaved();
  all[SIG.key] = { ts: Date.now(), name: SIG.name, items: tested.map(c => ({ acc: c.acc.id, sid: String(c.ch.stream_id), res: c.res })) };
  // Solo los 30 canales probados más recientes.
  const keys = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts);
  keys.slice(30).forEach(k => delete all[k]);
  store.set('jox3signal', all);
}
function sigLoadSaved(prev) {
  if (!prev) return false;
  const tested = [];
  for (const s of prev.items || []) {
    const c = SIG.cands.find(x => x.acc.id === s.acc && String(x.ch.stream_id) === s.sid);
    if (c && s.res) { c.res = s.res; c.score = sigScore(s.res); tested.push(c); }
  }
  if (!tested.length) return false;
  const ids = new Set(tested.map(c => c.id));
  SIG.cands.forEach(c => { if (ids.has(c.id)) c.on = true; });
  Object.assign(SIG, { tested, queue: [], cur: null, running: false, savedTs: prev.ts });
  renderSigRun();
  return true;
}
function sigAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60e3);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
