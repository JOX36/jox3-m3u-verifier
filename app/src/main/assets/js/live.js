'use strict';
// JOX3 Verifier — TV en vivo, verificación de canales y guía por horas.

/* ═══════════════════════════ PANTALLA: EN VIVO ═══════════════════════════ */
let liveObserver = null, epgObserver = null;
function noAccountHtml() {
  return emptyState('acc', 'Primero agrega una cuenta', 'Verifica una cuenta para ver su contenido aquí.',
    `<button class="btn primary" onclick="openAddAccount()">${icon('plus')}Agregar cuenta</button>`);
}
function chipsHtml(type, current) {
  const cats = catsOf(type);
  const chip = (key, label, extra = '') => `<button class="chip${String(current) === String(key) ? ' on' : ''}" data-cat="${esc(key)}" onclick="selectCat('${type}',${jsArg(String(key))})">${extra}${esc(label)}</button>`;
  return chip('*', 'Categorías', icon('folder')) + (type !== 'live' ? chip('new', 'Recientes', icon('history')) : '') + chip('fav', 'Favoritos', icon('star')) + cats.map(c => chip(c.category_id, cleanCatName(c.category_name).name)).join('');
}
function defaultCat(type) {
  const saved = S.cfg[`cat_${S.activeId}_${type}`];
  if (saved && (saved === 'fav' || saved === '*' || (saved === 'new' && type !== 'live') || catsOf(type).some(c => String(c.category_id) === String(saved)))) return saved;
  return '*';
}
function categoryCounts(type) {
  const all = S.lists[`${type}:*`]; if (!all) return null;
  const c = {}; for (const it of all) c[it.category_id] = (c[it.category_id] || 0) + 1; return c;
}
function categoryListHtml(type) {
  const cats = catsOf(type), counts = categoryCounts(type), favN = Object.keys(favMap(type)).length;
  if (!cats.length) return emptyState('folder', 'Sin categorías', 'Este servidor no tiene categorías de este tipo.');
  const unit = type === 'live' ? 'canales' : type === 'vod' ? 'películas' : 'series';
  const card = (key, name, sub, th, extra = '') => `<button class="row cat-row cc${extra}" data-name="${esc(normTxt(name))}" style="--ca:${th.a};--cb:${th.b}" onclick="selectCat('${type}',${jsArg(String(key))})">
      <span class="cc-ic">${icon(th.ic)}</span><span class="n"><b>${esc(name)}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  const hidden = parentalLocked() ? allCatsOf(type).length - cats.length : 0;
  return `${cats.length > 10 ? `<div class="search">${icon('search')}<input type="text" placeholder="Buscar categoría" oninput="filterCatRows(this)" autocomplete="off"></div>` : ''}
    <div class="cat-rows cgrid">${favN ? card('fav', 'Favoritos', `${favN} ${favN === 1 ? 'guardado' : 'guardados'}`, { ic: 'star', a: '#c98a12', b: '#4d3306' }) : ''}
    ${type !== 'live' ? card('new', 'Recientes', 'Lo último que agregaron', { ic: 'history', a: 'rgba(var(--ar),.55)', b: 'var(--surface)' }) : ''}
    ${cats.map(c => {
      const { name, cc } = cleanCatName(c.category_name), th = catTheme(type, c.category_name || '', cc);
      const n = counts ? `${fmtNum(counts[c.category_id] || 0)} ${unit}` : '';
      return card(c.category_id, name, [cc ? `<em>${esc(cc)}</em>` : '', esc(n)].filter(Boolean).join(' '), th);
    }).join('')}
    ${hidden > 0 ? `<button class="row cat-row cc locked" data-name="" onclick="askUnlock()"><span class="cc-ic">${icon('lock')}</span><span class="n"><b>${hidden} ${hidden === 1 ? 'oculta' : 'ocultas'}</b><small>Control parental</small></span></button>` : ''}</div>`;
}
function filterCatRows(inp) {
  const q = inp.value.trim().toLowerCase();
  const nq = normTxt(q);
  inp.closest('.scroll').querySelectorAll('.cat-row').forEach(r => { r.hidden = nq && !r.dataset.name.includes(nq); });
}
function selectCat(type, cat) {
  S.cfg[`cat_${S.activeId}_${type}`] = cat; saveCfg();
  if (type === 'live') loadLive(cat); else loadGrid(type, cat);
}

function ensureLive(cat) {
  if (!S.session) { $('live-chips').innerHTML = ''; $('live-bar').hidden = true; $('live-body').innerHTML = noAccountHtml(); return; }
  if (cat) S.cfg[`cat_${S.activeId}_live`] = cat;
  const want = cat || defaultCat('live');
  if (S.view.live === want && $('live-body').childElementCount) return;
  loadLive(want);
}

async function loadLive(cat) {
  S.view.live = cat;
  $('live-chips').innerHTML = chipsHtml('live', cat);
  const on = $('live-chips').querySelector('.chip.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  const body = $('live-body'); $('live-bar').hidden = true;
  body.classList.remove('guide-mode'); stopGuideClock();
  stopChecks();
  S.liveAll = [];
  if (cat === '*') { body.scrollTop = 0; body.innerHTML = categoryListHtml('live'); return; }
  body.innerHTML = skelList();
  let items;
  try { items = cat === 'fav' ? Object.values(favMap('live')) : await getList('live', cat); }
  catch (e) { if (S.view.live === cat) body.innerHTML = errorState('live', e, `loadLive(${jsArg(cat)})`); return; }
  if (S.view.live !== cat) return;
  if (!items.length) {
    body.innerHTML = cat === 'fav' ? emptyState('star', 'Aún no tienes favoritos', 'Toca la estrella de un canal para tenerlo siempre a mano aquí.') : emptyState('live', 'Esta categoría está vacía', 'Elige otra categoría arriba.');
    return;
  }
  S.liveAll = filterAllowed('live', items);
  if (!S.liveAll.length) { body.innerHTML = emptyState('lock', 'Contenido oculto', 'El control parental oculta lo que hay aquí.', `<button class="btn" onclick="askUnlock()">${icon('lock')}Desbloquear</button>`); return; }
  renderLiveList();
}

function liveVisibleItems() {
  const all = S.liveAll || [];
  return S.onlineOnly ? all.filter(i => S.status[i.stream_id] !== false) : all;
}
function renderLiveList() {
  if (liveViewMode() === 'guide') { renderGuide(); return; }
  $('live-body').classList.remove('guide-mode'); stopGuideClock();
  const body = $('live-body'), items = liveVisibleItems();
  S.rendered.live = items;
  body.scrollTop = 0;
  body.innerHTML = `<div id="live-list"></div><div class="more-sentinel" id="live-more"></div>`;
  S.liveShown = 0;
  appendLive();
  if (liveObserver) liveObserver.disconnect();
  liveObserver = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) appendLive(); }, { root: body, rootMargin: '600px' });
  liveObserver.observe($('live-more'));
  updateLiveBar();
}
function logoHtml(name, img) {
  const h = hue(name);
  const fallback = `<span style="background:hsl(${h} 55% 32%);width:100%;height:100%;display:grid;place-items:center;border-radius:7px">${esc(initials(name))}</span>`;
  if (!img) return `<span class="logo" style="padding:0">${fallback}</span>`;
  return `<span class="logo"><img src="${esc(img)}" loading="lazy" alt="" onerror="this.parentNode.style.padding='0';this.outerHTML=this.dataset.fb" data-fb="${esc(fallback)}"></span>`;
}
function appendLive() {
  const list = $('live-list'); if (!list) return;
  const items = S.rendered.live, from = S.liveShown, to = Math.min(items.length, from + CHUNK_LIST);
  if (from >= to) return;
  const html = [];
  for (let i = from; i < to; i++) {
    const it = items[i], sid = it.stream_id, st = S.status[sid], name = itemName(it), fav = isFav('live', it);
    noteCh(it);
    html.push(`<div class="ch" data-i="${i}" data-sid="${esc(sid)}" onclick="playLive(${i})">
      <span class="num">${esc(it.num || i + 1)}</span>${logoHtml(name, it.stream_icon)}
      <span class="n"><b>${esc(name)}</b><small class="epg" data-sid="${esc(sid)}">${S.epg[sid] ? esc(S.epg[sid].text) : ''}</small>${S.epg[sid] && S.epg[sid].pct != null ? `<span class="p"><i style="width:${S.epg[sid].pct}%"></i></span>` : ''}</span>
      <span class="tally${st === true ? ' on' : st === false ? ' off' : ''}" data-sid="${esc(sid)}" title="${st === true ? 'En línea' : st === false ? 'Caído' : 'Verificando'}"></span>
      <button class="fav${fav ? ' on' : ''}" onclick="event.stopPropagation();toggleFav('live',S.rendered.live[${i}],this)" aria-label="Favorito">${icon(fav ? 'star' : 'star-o')}</button>
      <button class="fav" onclick="event.stopPropagation();openLiveActions(${i})" aria-label="Más opciones">${icon('more')}</button>
    </div>`);
  }
  list.insertAdjacentHTML('beforeend', html.join(''));
  const added = items.slice(from, to);
  S.liveShown = to;
  if (S.cfg.autoCheck) checkStreams(added);
  if (S.cfg.showEpg !== false) observeEpg(list);
}
function updateLiveBar() {
  const all = S.liveAll || [];
  if (!all.length) { $('live-bar').hidden = true; return; }
  let on = 0, off = 0;
  for (const it of all) { const s = S.status[it.stream_id]; if (s === true) on++; else if (s === false) off++; }
  $('live-bar').hidden = false;
  const pending = all.length - on - off, running = chk.queue.length + chk.inflight > 0;
  const bc = $('btn-check');
  bc.hidden = !running && pending === 0;
  bc.innerHTML = running ? `<span class="spinner"></span>Detener` : `${icon('check')}${on + off ? 'Seguir verificando' : 'Verificar canales'}`;
  $('btn-online').hidden = on + off === 0;
  const bv = $('btn-view');
  if (bv) bv.innerHTML = liveViewMode() === 'guide' ? `${icon('list')}Lista` : `${icon('history')}Guía`;
  $('live-count').textContent = on + off ? `${on} en línea${off ? ` · ${off} caídos` : ''}${running ? ` · revisando` : ''}` : `${fmtNum(all.length)} canales`;
  $('live-bar-on').style.width = `${on / all.length * 100}%`;
  $('live-bar-off').style.width = `${off / all.length * 100}%`;
  $('sw-online').classList.toggle('on', S.onlineOnly);
}
function toggleOnlineOnly() {
  S.onlineOnly = !S.onlineOnly; S.cfg.onlineOnly = S.onlineOnly; saveCfg();
  renderLiveList();
  if (S.onlineOnly) toast('Se ocultan los canales caídos');
}

/* ═══════════════════════════ GUÍA POR HORAS ═══════════════════════════ */
// Rejilla canal × hora para la categoría abierta. La guía de cada canal se pide
// solo cuando su fila aparece en pantalla, de a 2 y con pausa (no satura servidores).
const G = { ppm: 4, chW: 132, hours: 6, start: 0, end: 0, shown: 0, clock: null };
S.epgFull = {};
function liveViewMode() { return S.cfg.liveView === 'guide' ? 'guide' : 'list'; }
function toggleLiveView() { S.cfg.liveView = liveViewMode() === 'guide' ? 'list' : 'guide'; saveCfg(); renderLiveList(); }
function stopGuideClock() { if (G.clock) { clearInterval(G.clock); G.clock = null; } }
let guideObserver = null, guideRowObserver = null;
function renderGuide() {
  const body = $('live-body'), items = liveVisibleItems();
  S.rendered.live = items;
  G.ppm = window.IS_TV ? 5 : 4; G.chW = window.IS_TV ? 200 : 128;
  const now = Date.now() / 1000;
  G.start = Math.floor(now / 1800) * 1800 - 1800; G.end = G.start + G.hours * 3600;
  const W = (G.end - G.start) / 60 * G.ppm;
  let head = '';
  for (let t = G.start; t < G.end; t += 1800) head += `<span style="width:${30 * G.ppm}px">${fmtTime(t)}</span>`;
  body.classList.add('guide-mode');
  body.innerHTML = `<div class="guide" id="guide"><div class="g-inner" style="width:${G.chW + W}px">
      <div class="g-head"><span class="g-corner" style="width:${G.chW}px">Hoy</span>${head}</div>
      <div id="g-rows"></div><div class="g-now" id="g-now"></div><div class="more-sentinel" id="g-more"></div>
    </div></div>`;
  G.shown = 0;
  if (guideRowObserver) guideRowObserver.disconnect();
  guideRowObserver = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    guideRowObserver.unobserve(e.target);
    const sid = e.target.dataset.sid;
    if (!S.epgFull[sid]) { guideQueue.push(sid); pumpGuide(); }
  }), { root: $('guide'), rootMargin: '150px 0px' });
  appendGuide();
  if (guideObserver) guideObserver.disconnect();
  guideObserver = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) appendGuide(); }, { root: $('guide'), rootMargin: '500px 0px' });
  guideObserver.observe($('g-more'));
  placeNowLine();
  stopGuideClock(); G.clock = setInterval(placeNowLine, 60000);
  updateLiveBar();
}
function placeNowLine() {
  const l = $('g-now'); if (!l) { stopGuideClock(); return; }
  const x = G.chW + (Date.now() / 1000 - G.start) / 60 * G.ppm;
  l.style.left = `${x}px`;
}
function appendGuide() {
  const rows = $('g-rows'); if (!rows) return;
  const items = S.rendered.live, from = G.shown, to = Math.min(items.length, from + 40);
  if (from >= to) return;
  let html = '';
  for (let i = from; i < to; i++) {
    const it = items[i], sid = String(it.stream_id), name = itemName(it);
    noteCh(it);
    html += `<div class="g-row" data-sid="${esc(sid)}">
      <button class="g-ch" style="width:${G.chW}px" onclick="playLive(${i})">${logoHtml(name, it.stream_icon)}<span>${esc(name)}</span></button>
      <div class="g-line" data-sid="${esc(sid)}">${guideBlocks(sid, i)}</div></div>`;
  }
  rows.insertAdjacentHTML('beforeend', html);
  G.shown = to;
  rows.querySelectorAll('.g-row:not([data-obs])').forEach(r => { r.dataset.obs = '1'; guideRowObserver.observe(r); });
}
function guideBlocks(sid, idx) {
  const list = S.epgFull[sid];
  if (!list) return `<span class="g-empty">${S.epgOff && !extOn() ? 'Sin guía' : 'Cargando guía…'}</span>`;
  const now = Date.now() / 1000;
  const vis = list.filter(p => p.e > G.start && p.s < G.end);
  if (!vis.length) return `<span class="g-empty">Sin guía para estas horas</span>`;
  return vis.map((p, k) => {
    const a = Math.max(p.s, G.start), b = Math.min(p.e, G.end);
    const left = (a - G.start) / 60 * G.ppm, w = Math.max(18, (b - a) / 60 * G.ppm - 3);
    const st = p.e <= now ? 'past' : p.s <= now ? 'now' : '';
    return `<button class="g-prog ${st}" style="left:${left}px;width:${w}px" onclick="openProgram(${jsArg(sid)},${list.indexOf(p)},${idx})"><b>${esc(p.t)}</b><small>${fmtTime(p.s)}</small></button>`;
  }).join('');
}
const guideQueue = []; let guideActive = 0;
function pumpGuide() {
  while (guideActive < 2 && guideQueue.length && (serverEpgOk() || extOn())) {
    const sid = guideQueue.shift(); if (S.epgFull[sid]) continue;
    guideActive++;
    fetchEpgFull(sid).then(net => net, () => true).then(net => { guideActive--; setTimeout(pumpGuide, net ? 350 : 0); });
  }
  if (S.epgOff && !extOn()) document.querySelectorAll('.g-line .g-empty').forEach(e => { e.textContent = 'Sin guía'; });
}
async function fetchEpgFull(sid) {
  if (!S.session) return false;
  const accId = S.session.id;
  let list = [], net = false;
  if (serverEpgOk()) {
    net = true;
    try {
      const d = await apiGet(`${S.session.apiUrl}&action=get_short_epg&stream_id=${encodeURIComponent(sid)}&limit=14`, 12000, { noBrake: true });
      list = (d.epg_listings || []).map(x => ({ t: decodeB64(x.title).trim(), d: decodeB64(x.description || '').trim(), s: +x.start_timestamp || 0, e: +x.stop_timestamp || 0 }))
        .filter(x => x.t && x.e > x.s).sort((a, b) => a.s - b.s);
    } catch (e) { if (e && REJECT.has(e.status)) S.epgOff = true; }
  }
  if (!S.session || S.session.id !== accId) return net;
  if (!list.length) list = extPrograms(sid, G.start - 3600, G.end + 3600) || [];
  S.epgFull[sid] = list;
  // También alimenta la línea "Ahora" de la vista de lista.
  const now = Date.now() / 1000, cur = list.find(p => p.s <= now && p.e > now);
  if (cur && (!S.epg[sid] || S.epg[sid].none)) S.epg[sid] = { text: `Ahora: ${cur.t} · ${fmtTime(cur.s)}`, pct: Math.round((now - cur.s) / (cur.e - cur.s) * 100), title: cur.t, s: cur.s, e: cur.e, ext: !!cur.ext };
  document.querySelectorAll(`.g-line[data-sid="${CSS.escape(String(sid))}"]`).forEach(el => {
    const idx = S.rendered.live.findIndex(it => String(it.stream_id) === String(sid));
    el.innerHTML = guideBlocks(sid, idx);
  });
  return net;
}
function openProgram(sid, k, idx) {
  const p = (S.epgFull[sid] || [])[k]; if (!p) return;
  const it = S.rendered.live[idx], now = Date.now() / 1000;
  const live = p.s <= now && p.e > now, past = p.e <= now;
  const day = new Date(p.s * 1000).toDateString() === new Date().toDateString() ? 'Hoy' : new Date(p.s * 1000).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric' });
  const pct = live ? Math.round((now - p.s) / (p.e - p.s) * 100) : 0;
  showSheet(p.t, `
    <div class="hint" style="margin:-4px 0 10px">${esc(it ? itemName(it) : '')} · ${esc(day)} ${fmtTime(p.s)} – ${fmtTime(p.e)}${live ? ' · <b style="color:var(--off)">EN VIVO</b>' : past ? ' · ya terminó' : ''}${p.ext ? ' · guía de internet' : ''}</div>
    ${live ? `<div class="upd-bar" style="margin:0 0 12px"><i style="width:${pct}%"></i></div>` : ''}
    ${p.d ? `<p class="syn" style="margin-top:0">${esc(p.d)}</p>` : '<div class="hint">Sin descripción.</div>'}
    <div class="list-actions" style="margin-top:16px">
      ${it ? `<button class="btn primary" onclick="closeTop();playLive(${idx})">${icon('play')}${live ? 'Ver ahora' : 'Ver el canal'}</button>` : ''}
      ${p.ext ? `<button class="btn" onclick="openExtPicker(${jsArg(sid)})">${icon('info')}¿Guía equivocada?</button>` : ''}
      <button class="btn" onclick="closeTop()">Cerrar</button>
    </div>`);
}

/* ─── Verificación de canales (Kotlin: NativeChecker) ─── */
// Cada verificación abre una conexión real al canal: se hacen de a 2, con pausa,
// para no parecer un ataque ante el servidor (algunos bloquean la IP).
const CHECK_PARALLEL = 2, CHECK_GAP_MS = 300;
const chk = { queue: [], inflight: 0, offStreak: 0, inflightIds: new Set() };
function stopChecks() {
  chk.queue = []; chk.inflight = 0; chk.offStreak = 0; chk.inflightIds.clear();
  try { if (window.NativeChecker && NativeChecker.cancelAll) NativeChecker.cancelAll(); } catch { }
  if (typeof updateLiveBar === 'function' && $('live-bar')) refreshLiveBarSoon();
}
function checkCurrent() {
  if (chk.queue.length + chk.inflight > 0) { stopChecks(); updateLiveBar(); return; }
  clearRejected();
  checkStreams(S.liveAll || []);
}
function checkStreams(items) {
  if (!S.session || isRejecting()) return;
  const queued = new Set(chk.queue.map(i => i.stream_id));
  for (const it of items) if (S.status[it.stream_id] === undefined && !queued.has(it.stream_id) && !chk.inflightIds.has(String(it.stream_id))) chk.queue.push(it);
  pumpChecks(); updateLiveBar();
}
function pumpChecks() {
  while (chk.inflight < CHECK_PARALLEL && chk.queue.length) {
    const it = chk.queue.shift();
    if (S.status[it.stream_id] !== undefined) continue;
    chk.inflight++; chk.inflightIds.add(String(it.stream_id));
    sendCheck(it);
  }
}
function sendCheck(it) {
  const id = String(it.stream_id), url = streamUrl('live', it);
  if (window.NativeChecker && NativeChecker.checkStream) { NativeChecker.checkStream(url, id); return; }
  // Fuera de la app (navegador): aproximación, sin código de estado real.
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000);
  fetch(url, { method: 'HEAD', mode: 'no-cors', signal: c.signal }).then(() => window.onStreamChecked(id, true)).catch(() => window.onStreamChecked(id, false)).finally(() => clearTimeout(t));
}
const refreshLiveBarSoon = debounce(updateLiveBar, 250);
window.onStreamChecked = function (id, online) {
  if (id === '__diag__') { if (diagResolve) diagResolve(online); return; }
  if (chk.inflightIds.delete(String(id))) {
    chk.inflight = Math.max(0, chk.inflight - 1);
    chk.offStreak = online ? 0 : chk.offStreak + 1;
    if (chk.offStreak >= 12) {
      stopChecks();
      toast('12 canales seguidos sin respuesta: pausé la verificación para no saturar el servidor', 'err');
    } else setTimeout(pumpChecks, CHECK_GAP_MS);
  }
  S.status[id] = online;
  document.querySelectorAll(`.tally[data-sid="${CSS.escape(String(id))}"]`).forEach(t => {
    t.className = `tally ${online ? 'on' : 'off'}`; t.title = online ? 'En línea' : 'Caído';
  });
  if (!online && S.onlineOnly) document.querySelectorAll(`#live-list .ch[data-sid="${CSS.escape(String(id))}"]`).forEach(r => r.remove());
  refreshLiveBarSoon();
};

/* ─── Guía (EPG) para los canales visibles ─── */
/* ─── Guía de internet (Kotlin: ExternalEpg) ─── */
// Si el servidor no trae guía para un canal, se busca en guías públicas XMLTV por país
// (epgshare01). Se bajan solas una vez al día; el canal se reconoce por su código de guía o su nombre.
// Todas las guías por país que publica la fuente. Las marcadas como grandes pesan varios MB.
const EXT_COUNTRIES = [
  ['CO1', 'Colombia', 'CO'], ['EC1', 'Ecuador', 'EC'], ['MX1', 'México', 'MX'], ['AR1', 'Argentina', 'AR'], ['CL1', 'Chile', 'CL'], ['PE1', 'Perú', 'PE'],
  ['CR1', 'Costa Rica', 'CR'], ['PA1', 'Panamá', 'PA'], ['DO1', 'República Dominicana', 'DO'], ['SV1', 'El Salvador', 'SV'], ['UY1', 'Uruguay', 'UY', 1],
  ['BR1', 'Brasil', 'BR'], ['JM1', 'Jamaica', 'JM'], ['ES1', 'España', 'ES', 1], ['US2', 'Estados Unidos', 'US', 1], ['CA2', 'Canadá', 'CA', 1],
  ['UK1', 'Reino Unido', 'UK', 1], ['IE1', 'Irlanda', 'IE', 1], ['PT1', 'Portugal', 'PT'], ['FR1', 'Francia', 'FR', 1], ['IT1', 'Italia', 'IT'],
  ['DE1', 'Alemania', 'DE', 1], ['NL1', 'Países Bajos', 'NL'], ['BE2', 'Bélgica', 'BE', 1], ['CH1', 'Suiza', 'CH', 1], ['AT1', 'Austria', 'AT', 1],
  ['TR1', 'Turquía', 'TR'], ['IN1', 'India', 'IN', 1], ['AU1', 'Australia', 'AU', 1], ['PH2', 'Filipinas', 'PH'], ['JP1', 'Japón', 'JP'], ['KR1', 'Corea', 'KR'],
];
const EXT_FILES = Object.fromEntries(EXT_COUNTRIES.map(c => [c[2], c[0]]));
Object.assign(EXT_FILES, { USA: 'US2', GB: 'UK1', COL: 'CO1', ARG: 'AR1', MEX: 'MX1', CHI: 'CL1', ESP: 'ES1', BRA: 'BR1', POR: 'PT1' });
const EXT_BIG = new Set(EXT_COUNTRIES.filter(c => c[3]).map(c => c[0]));
const EXT_WORDS = [[/mexic/, 'MX'], [/argentin/, 'AR'], [/chile/, 'CL'], [/peru/, 'PE'], [/ecuador/, 'EC'], [/costa rica/, 'CR'], [/panama/, 'PA'], [/dominican/, 'DO'],
  [/uruguay/, 'UY'], [/salvador/, 'SV'], [/brasil|brazil/, 'BR'], [/espan|spain/, 'ES'], [/estados unidos|eeuu|\busa\b/, 'US'], [/canada/, 'CA'], [/reino unido|\buk\b|united kingdom/, 'UK'],
  [/portugal/, 'PT'], [/francia|france/, 'FR'], [/italia|italy/, 'IT'], [/alemania|germany|deutsch/, 'DE'], [/turqu|turk/, 'TR'], [/jamaica/, 'JM']];
const EXT_SPORTS = ['US_SPORTS1', 'BEIN1', 'DIRECTVSPORTS1'];
const S_meta = {};   // stream_id → { n: nombre, g: código de guía, c: país de su categoría }
// País de una categoría de En vivo ("EC | DEPORTES", "ECUADOR") para preferir la guía de ese país.
const catCountryCache = {};
function catCountry(catId) {
  const k = String(catId); if (k in catCountryCache) return catCountryCache[k];
  const c = allCatsOf('live').find(x => String(x.category_id) === k); let cc = '';
  if (c) {
    cc = cleanCatName(c.category_name).cc;
    if (!cc) { const n = normTxt(c.category_name); for (const [rx, code] of EXT_WORDS) if (rx.test(n)) { cc = code; break; } }
    if (!cc && /colombia/.test(normTxt(c.category_name))) cc = 'CO';
  }
  return (catCountryCache[k] = cc === 'USA' ? 'US' : cc === 'COL' ? 'CO' : cc);
}
function noteCh(it) { if (it && it.stream_id != null) S_meta[String(it.stream_id)] = { n: itemName(it), g: it.epg_channel_id || '', c: catCountry(it.category_id) }; }
function extOn() { return S.cfg.extEpg !== false && !!(window.NativeEpg && NativeEpg.lookupIn); }
function extDetected() {
  const count = {};
  const add = (cc, w = 1) => { const f = EXT_FILES[cc]; if (f) count[f] = (count[f] || 0) + w; };
  for (const c of allCatsOf('live')) {
    const { cc } = cleanCatName(c.category_name); if (cc) add(cc);
    const n = normTxt(c.category_name); for (const [rx, k] of EXT_WORDS) if (rx.test(n)) add(k);
  }
  // También el país del equipo (es-EC → Ecuador) y el del servidor.
  const reg = (navigator.language || '').split('-')[1]; if (reg) add(reg.toUpperCase(), 2);
  const g = (activeAccount() || {}).geo; if (g && g.countryCode) add(g.countryCode, 0.5);
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}
// Países de la guía: los elegidos en Ajustes o, si no hay elección, los que se detectan solos.
function extCountryFiles() {
  if (Array.isArray(S.cfg.extCountries)) return S.cfg.extCountries;
  // Los países chicos (casi toda Latinoamérica) van todos; de los grandes, solo los 3 con más canales.
  const det = extDetected();
  const small = det.filter(f => !EXT_BIG.has(f)), big = det.filter(f => EXT_BIG.has(f)).slice(0, 3);
  return [...new Set(['CO1', ...small, ...big])];
}
function extCodes() { return [...new Set([...extCountryFiles(), ...EXT_SPORTS])]; }
function ensureExtEpg() {
  if (!extOn() || !S.session) return;
  try { NativeEpg.ensure(extCodes().join(',')); } catch { }
}
// Programas de la guía de internet para un canal (o null si no está).
function extPrograms(sid, from, to) { return extProgramsFor(S_meta[String(sid)], from, to); }
function extProgramsFor(m, from, to) {
  if (!extOn() || !m) return null;
  try {
    const r = NativeEpg.lookupIn(m.n, m.g || '', Math.floor(from), Math.floor(to), m.c || '');
    if (!r) return null;
    const d = JSON.parse(r);
    return (d.list || []).map(x => ({ t: x.t, d: x.d || '', s: +x.s, e: +x.e, ext: true })).filter(x => x.t && x.e > x.s).sort((a, b) => a.s - b.s);
  } catch { return null; }
}
function extNowEntry(sid, meta) {
  const now = Date.now() / 1000, list = meta ? extProgramsFor(meta, now - 3600, now + 6 * 3600) : extPrograms(sid, now - 3600, now + 6 * 3600);
  if (!list || !list.length) return null;
  const cur = list.find(x => x.e > now && x.s <= now) || list.find(x => x.e > now);
  if (!cur) return null;
  const pct = cur.s <= now ? Math.round((now - cur.s) / (cur.e - cur.s) * 100) : null;
  return { text: `${cur.s <= now ? 'Ahora' : 'Luego'}: ${cur.t} · ${fmtTime(cur.s)}`, pct, title: cur.t, s: cur.s, e: cur.e, ext: true };
}
// Cuando termina de bajar/leer la guía: volver a buscar los canales que quedaron sin guía.
window.onExtEpgReady = function () {
  for (const sid of Object.keys(S.epg)) {
    if (!S.epg[sid].none) continue;
    delete S.epg[sid];
    if (document.querySelector(`small.epg[data-sid="${CSS.escape(sid)}"]`)) epgQueue.push(sid);
  }
  for (const sid of Object.keys(S.epgFull)) if (!S.epgFull[sid].length) { delete S.epgFull[sid]; if (document.querySelector(`.g-line[data-sid="${CSS.escape(sid)}"]`)) guideQueue.push(sid); }
  pumpEpg(); pumpGuide();
};
// Ajustes: qué países de guía descargar.
function openExtCountries() {
  const sel = new Set(extCountryFiles()), det = new Set(extDetected());
  let st = {}; try { st = JSON.parse(NativeEpg.status()); } catch { }
  const loaded = new Set(st.codes || []);
  showSheet('Países de la guía', `
    <div class="hint" style="margin:-4px 0 10px">${Array.isArray(S.cfg.extCountries) ? 'Elegidos por ti.' : 'Elegidos solos según tus categorías y tu país.'} La guía de deportes (ESPN, DSports, beIN) va siempre.</div>
    ${EXT_COUNTRIES.map(([f, n, , big]) => `<button class="set-row" onclick="toggleExtCountry('${f}')"><span class="n"><b>${esc(n)}</b><small>${[det.has(f) ? 'Detectado' : '', big ? 'Archivo grande' : '', loaded.has(f) ? 'Descargada' : sel.has(f) ? 'Se descargará' : ''].filter(Boolean).join(' · ') || '&nbsp;'}</small></span><span class="switch${sel.has(f) ? ' on' : ''}"></span></button>`).join('')}
    ${Array.isArray(S.cfg.extCountries) ? `<button class="btn block" style="margin-top:12px" onclick="S.cfg.extCountries=null;saveCfg();ensureExtEpg();openExtCountries()">${icon('refresh')}Volver a automático</button>` : ''}`);
}
function toggleExtCountry(f) {
  const cur = new Set(extCountryFiles());
  if (cur.has(f)) cur.delete(f); else cur.add(f);
  S.cfg.extCountries = [...cur]; saveCfg();
  ensureExtEpg(); openExtCountries();
}
// Elegir a mano la guía de un canal (cuando no la encuentra sola o se equivoca).
function openExtPicker(sid) {
  const m = S_meta[String(sid)]; if (!m || !extOn()) return;
  let list = [];
  try { list = JSON.parse(NativeEpg.channels() || '[]'); } catch { }
  S.extPick = { sid: String(sid), list };
  showSheet('Guía para este canal', `
    <div class="hint" style="margin:-4px 0 10px">${esc(m.n)} · elige el canal en la guía de internet</div>
    <div class="search">${icon('search')}<input type="text" id="ext-q" placeholder="Buscar canal en la guía" oninput="renderExtPicker()" autocomplete="off"></div>
    <button class="menu-item" onclick="setExtGuide('')">${icon('refresh')}Automática</button>
    <button class="menu-item" onclick="setExtGuide('none')">${icon('close')}Este canal no tiene guía</button>
    <div id="ext-list"></div>`);
  renderExtPicker();
}
function renderExtPicker() {
  const q = normTxt(($('ext-q') || {}).value || ''), st = S.extPick; if (!st) return;
  const hits = st.list.filter(c => !q || normTxt(c.n).includes(q)).slice(0, 80);
  $('ext-list').innerHTML = hits.length ? hits.map(c => `<button class="menu-item" onclick="setExtGuide(${jsArg(c.k)})">${icon('tv')}<span style="flex:1">${esc(c.n)}</span><small class="hint">${esc(c.c.replace(/\d+$/, ''))}</small></button>`).join('')
    : `<div class="hint" style="padding:14px 4px">${st.list.length ? 'Sin coincidencias' : 'La guía de internet todavía se está descargando. Prueba en un momento.'}</div>`;
}
function setExtGuide(key) {
  const st = S.extPick; if (!st) return;
  const m = S_meta[st.sid];
  try { NativeEpg.setManual(m.n, key); } catch { }
  delete S.epg[st.sid]; delete S.epgFull[st.sid];
  closeTop();
  epgQueue.push(st.sid); pumpEpg();
  if (document.querySelector(`.g-line[data-sid="${CSS.escape(st.sid)}"]`)) { guideQueue.push(st.sid); pumpGuide(); }
  toast(key === 'none' ? 'Guía quitada para este canal' : key ? 'Guía asignada' : 'Guía automática', 'ok');
}

const epgQueue = []; let epgActive = 0;
function observeEpg(list) {
  if (!epgObserver) {
    epgObserver = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        epgObserver.unobserve(e.target);
        const sid = e.target.dataset.sid;
        if (!S.epg[sid]) { epgQueue.push(sid); pumpEpg(); }
      });
    }, { root: $('live-body'), rootMargin: '200px' });
  }
  list.querySelectorAll('small.epg:not([data-obs])').forEach(el => { el.dataset.obs = '1'; epgObserver.observe(el); });
}
function serverEpgOk() { return !S.epgOff && !isRejecting(); }
function pumpEpg() {
  while (epgActive < 1 && epgQueue.length && (serverEpgOk() || extOn())) {
    const sid = epgQueue.shift(); if (S.epg[sid]) continue;
    epgActive++;
    // Si se consultó al servidor, pausa; si solo se usó la guía de internet (local), sigue enseguida.
    fetchEpg(sid).then(net => net, () => true).then(net => { epgActive--; setTimeout(pumpEpg, net ? 700 : 0); });
  }
}
async function fetchEpg(sid) {
  if (!S.session) return false;
  const accId = S.session.id;
  let entry = null, net = false;
  if (serverEpgOk()) {
    net = true;
    try {
      const d = await apiGet(`${S.session.apiUrl}&action=get_short_epg&stream_id=${encodeURIComponent(sid)}&limit=2`, 10000, { noBrake: true });
      const now = Date.now() / 1000;
      const list = (d.epg_listings || []).map(x => ({ t: decodeB64(x.title).trim(), s: +x.start_timestamp || 0, e: +x.stop_timestamp || 0 })).filter(x => x.t);
      const cur = list.find(x => x.e > now) || list[0];
      if (cur) {
        const pct = cur.e > cur.s ? Math.max(0, Math.min(100, (now - cur.s) / (cur.e - cur.s) * 100)) : null;
        entry = { text: `Ahora: ${cur.t}${cur.s ? ` · ${fmtTime(cur.s)}` : ''}`, pct: pct === null ? null : Math.round(pct), title: cur.t, s: cur.s, e: cur.e };
      }
    } catch (e) {
      if (e && REJECT.has(e.status)) S.epgOff = true;   // el servidor no da guía: no insistir
    }
  }
  if (!S.session || S.session.id !== accId) return net;
  // Sin guía en el servidor: la de internet.
  if (!entry) entry = extNowEntry(sid);
  if (!entry) entry = { text: 'Sin guía disponible', pct: null, none: true };
  S.epg[sid] = entry;
  document.querySelectorAll(`small.epg[data-sid="${CSS.escape(String(sid))}"]`).forEach(el => {
    el.textContent = entry.text;
    const n = el.parentNode; if (entry.pct != null && !n.querySelector('.p')) n.insertAdjacentHTML('beforeend', `<span class="p"><i style="width:${entry.pct}%"></i></span>`);
  });
  return net;
}

function playLive(i) {
  const items = S.rendered.live; if (!items[i]) return;
  // Para listas enormes se envía una ventana alrededor del canal elegido.
  const MAXP = 1500; let start = 0, slice = items;
  if (items.length > MAXP) { start = Math.max(0, i - MAXP / 2); slice = items.slice(start, start + MAXP); }
  const label = S.view.live === 'fav' ? 'Favoritos' : S.view.live === '*' ? 'TV en Vivo' : (catName('live', S.view.live) || 'TV en Vivo');
  nativePlay(slice.map(it => ({ name: itemName(it), url: streamUrl('live', it), streamId: String(it.stream_id), isLive: true, poster: it.stream_icon || '', epgId: it.epg_channel_id || '' })), i - start, label);
}
function openLiveActions(i) {
  const it = S.rendered.live[i]; if (!it) return;
  const fav = isFav('live', it);
  showSheet(itemName(it), `
    <button class="menu-item" onclick="closeTop();playLive(${i})">${icon('play')}Reproducir</button>
    <button class="menu-item" onclick="closeTop();openBestSignal(${i})">${icon('signal')}Mejor señal<small class="mi-sub">Compara este canal en todas tus cuentas</small></button>
    <button class="menu-item" onclick="closeTop();addLiveToList(${i})">${icon('list')}Añadir a Mi lista</button>
    <button class="menu-item" onclick="closeTop();toggleFav('live',S.rendered.live[${i}]);refreshFavIcons()">${icon(fav ? 'star' : 'star-o')}${fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}</button>
    <button class="menu-item" onclick="closeTop();copyText(${jsArg(streamUrl('live', it))},'Enlace del canal copiado')">${icon('copy')}Copiar enlace</button>
    ${extOn() ? `<button class="menu-item" onclick="openExtPicker(${jsArg(String(it.stream_id))})">${icon('history')}Elegir guía de internet</button>` : ''}`);
}
function refreshFavIcons() {
  document.querySelectorAll('#live-list .ch').forEach(r => {
    const it = S.rendered.live[+r.dataset.i]; const b = r.querySelector('.fav'); if (!it || !b) return;
    const f = isFav('live', it); b.classList.toggle('on', f); b.innerHTML = icon(f ? 'star' : 'star-o');
  });
}
function addLiveToList(i) {
  const it = S.rendered.live[i]; if (!it) return;
  addToList({ name: itemName(it), url: streamUrl('live', it), category: catsOf('live').find(c => String(c.category_id) === String(it.category_id))?.category_name || 'TV en Vivo', synopsis: '', thumbnail: it.stream_icon || '' });
}
