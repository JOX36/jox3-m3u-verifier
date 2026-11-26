'use strict';
// JOX3 Verifier — Búsqueda universal.

/* ═══════════════════════════ BÚSQUEDA UNIVERSAL ═══════════════════════════ */
// Busca en todas las cuentas activas a la vez y agrupa por título, indicando en qué servidor está cada uno.
let searchType = 'all';
S.searchScope = 'all';
S.accLists = {};
function usableAccounts() {
  return S.accounts.filter(a => a.status === 'Active' && (daysLeft(a) === null || daysLeft(a) >= 0))
    .sort((x, y) => (y.id === S.activeId) - (x.id === S.activeId));
}
function sessionFor(id) {
  if (id === S.activeId && S.session) return S.session;
  const a = accountById(id); return a ? buildSession(a, { live: [], vod: [], series: [] }) : S.session;
}
// Catálogo completo de un tipo para cualquier cuenta (con caché).
async function getListFor(acc, type) {
  if (acc.id === S.activeId && S.session) return getList(type, '*');
  const key = `${acc.id}:${type}`;
  if (S.accLists[key]) return S.accLists[key];
  const dbKey = `list:${acc.id}:${type}:*`;
  const cached = await idb.get(dbKey);
  if (cached && Date.now() - cached.ts < TTL_STREAMS && Array.isArray(cached.items)) { markFresh(acc.id, type, cached.ts); return (S.accLists[key] = cached.items); }
  const data = await apiGet(`${apiUrlOf(acc)}&action=${TYPES[type].streams}`, 90000, { noBrake: true });
  const items = Array.isArray(data) ? data : [];
  S.accLists[key] = items; idb.set(dbKey, { ts: Date.now(), items });
  markFresh(acc.id, type);
  return items;
}

/* ─── Precarga lenta del catálogo completo ─── */
// Primero la cuenta con la que arrancas (lo hace Inicio). Después, en segundo plano y con mucha
// pausa entre una descarga y otra, el resto de catálogos de todas tus cuentas activas: así la
// búsqueda universal ya los tiene guardados. Se pausa mientras ves algo o la app está detrás.
const PRE_GAP = 45e3, PRE_FIRST = 40e3;
const PRE = { timer: null, fail: {}, busy: false, last: '' };
const freshIdx = () => store.get('jox3fresh', {}) || {};
function markFresh(accId, type, ts = Date.now()) { const f = freshIdx(); f[`${accId}:${type}`] = ts; store.set('jox3fresh', f); }
function isFresh(accId, type) { const t = freshIdx()[`${accId}:${type}`]; return !!t && Date.now() - t < TTL_STREAMS; }
function preloadOn() { return S.cfg.preload !== false; }
function preloadJobs() {
  const accs = usableAccounts(), jobs = [];
  const act = accs.find(a => a.id === S.activeId);
  const order = act ? [act, ...accs.filter(a => a !== act)] : accs;
  for (const a of order) for (const t of ['live', 'vod', 'series']) jobs.push({ acc: a, type: t });
  return jobs;
}
function preloadStatus() {
  const jobs = preloadJobs(); const ok = jobs.filter(j => isFresh(j.acc.id, j.type)).length;
  return { ok, total: jobs.length };
}
function schedulePreload(ms = PRE_GAP) {
  clearTimeout(PRE.timer); PRE.timer = null;
  if (preloadOn()) PRE.timer = setTimeout(preloadStep, ms);
}
async function preloadStep() {
  PRE.timer = null;
  if (!preloadOn() || PRE.busy) return;
  // No molestar: app detrás o reproduciendo, verificando cuentas, o un servidor frenando.
  if (S.paused || document.hidden || bulk.running || isRejecting() || chk.inflight || chk.queue.length) { schedulePreload(PRE_GAP); return; }
  const job = preloadJobs().find(j => !isFresh(j.acc.id, j.type) && Date.now() - (PRE.fail[`${j.acc.id}:${j.type}`] || 0) > 3600e3);
  if (!job) { schedulePreload(30 * 60e3); return; }   // todo al día: revisar de nuevo en media hora
  PRE.busy = true; PRE.last = `${serverName(job.acc)} · ${TYPES[job.type].label}`;
  try {
    if (job.acc.id === S.activeId && S.session) await getList(job.type, '*');
    else {
      // Otras cuentas: se guarda en el equipo, sin dejarlo en memoria (los TV box tienen poca).
      const data = await apiGet(`${apiUrlOf(job.acc)}&action=${TYPES[job.type].streams}`, 120000, { noBrake: true });
      const items = Array.isArray(data) ? data : [];
      await idb.set(`list:${job.acc.id}:${job.type}:*`, { ts: Date.now(), items });
      markFresh(job.acc.id, job.type);
    }
  } catch (e) { PRE.fail[`${job.acc.id}:${job.type}`] = Date.now(); }
  PRE.busy = false;
  schedulePreload(PRE_GAP);
}
window.onAppPause = () => { S.paused = true; };
window.onAppResume = () => { S.paused = false; };
function openSearch() {
  if (!S.accounts.length) { toast('Primero agrega una cuenta', 'err'); switchTab('home'); return; }
  if (usableAccounts().length < 2) S.searchScope = 'active';
  showPage('page-search');
  renderSearchFilters();
  setTimeout(() => $('search-input').focus(), 250);
  if (!$('search-input').value) $('search-body').innerHTML = `<div class="hint" style="padding:12px 4px">Busca por nombre en todo el catálogo. Con "Todas las cuentas" busca a la vez en cada cuenta activa y te dice en qué servidor está cada resultado. La primera búsqueda descarga los catálogos, uno por uno; las siguientes son instantáneas.</div>`;
}
function renderSearchFilters() {
  const f = [['all', 'Todo'], ['live', 'En vivo'], ['vod', 'Películas'], ['series', 'Series']];
  const n = usableAccounts().length;
  $('search-filters').innerHTML = f.map(([k, l]) => `<button class="chip${searchType === k ? ' on' : ''}" onclick="searchType='${k}';renderSearchFilters();runSearch(true)">${l}</button>`).join('');
  $('search-scope').innerHTML = n > 1
    ? `<button class="${S.searchScope === 'all' ? 'on' : ''}" onclick="S.searchScope='all';renderSearchFilters();runSearch(true)">Todos los servidores (${n})</button><button class="${S.searchScope === 'active' ? 'on' : ''}" onclick="S.searchScope='active';renderSearchFilters();runSearch(true)">Solo ${esc(activeAccount()?.username || 'esta cuenta')}</button>`
    : '';
  $('search-scope').hidden = n < 2;
}
const onSearchInput = debounce(() => runSearch(false), 400);
function clearSearch() { $('search-input').value = ''; $('search-clear').hidden = true; $('search-body').innerHTML = ''; $('search-input').focus(); }
const normTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let searchGen = 0;
async function runSearch(force) {
  const q = $('search-input').value.trim(); $('search-clear').hidden = !q;
  const body = $('search-body');
  if (q.length < 2) { if (force && q) toast('Escribe al menos 2 letras'); if (!q) body.innerHTML = ''; return; }
  const gen = ++searchGen;
  const types = searchType === 'all' ? ['live', 'vod', 'series'] : [searchType];
  const accs = S.searchScope === 'all' ? usableAccounts() : [activeAccount()].filter(Boolean);
  if (!accs.length) { body.innerHTML = emptyState('acc', 'No hay cuentas activas', 'Verifica una cuenta para poder buscar.'); return; }
  const nq = normTxt(q), errors = [], perAcc = [];
  let step = 0; const steps = accs.length * types.length;
  // Una cuenta y un tipo a la vez, para no saturar a ningún servidor.
  for (const acc of accs) {
    const found = { acc, live: [], series: [], vod: [] };
    for (const t of types) {
      step++;
      const inMem = acc.id === S.activeId ? S.lists[`${t}:*`] : S.accLists[`${acc.id}:${t}`];
      if (!inMem) body.innerHTML = loadingHtml(`Descargando ${TYPES[t].label.toLowerCase()} de ${serverName(acc)} (${step} de ${steps})…`);
      try {
        const all = await getListFor(acc, t);
        if (parentalLocked()) await loadAccCats(acc.id);
        found[t] = filterAllowed(t, all.filter(it => normTxt(itemName(it)).includes(nq)), acc.id).sort((x, y) => itemName(x).localeCompare(itemName(y)));
      } catch (e) { errors.push({ acc, t, e }); }
      if (gen !== searchGen) return;
    }
    perAcc.push(found);
  }
  S.searchByAcc = perAcc;
  const order = ['live', 'series', 'vod'].filter(t => types.includes(t));
  const total = perAcc.reduce((n, f) => n + order.reduce((m, t) => m + f[t].length, 0), 0);
  if (!total && !errors.length) { body.innerHTML = emptyState('search', `Nada para “${q}”`, accs.length > 1 ? `Se buscó en ${accs.length} servidores. Prueba con otra palabra.` : 'Prueba con otra palabra o revisa la ortografía.'); return; }
  const MAXR = 200;
  let html = '';
  perAcc.forEach((f, ai) => {
    const a = f.acc, n = order.reduce((m, t) => m + f[t].length, 0);
    const errs = errors.filter(x => x.acc.id === a.id);
    if (!n && !errs.length && accs.length > 1) return;
    html += `<details class="srv" open><summary>
        <span class="dot ${accLevel(a)}"></span>
        <span class="n"><b>${esc(serverName(a))}</b><small>${esc(a.username)} · ${esc(accDaysLabel(a))}${a.id === S.activeId ? ' · activa' : ''}</small></span>
        <span class="srv-n">${fmtNum(n)}</span>${icon('down', 'chev')}</summary>`;
    errs.forEach(x => { html += `<div class="hint" style="color:var(--warn);margin:4px 0">No se pudo buscar ${TYPES[x.t].label.toLowerCase()}: ${esc(x.e.message)}</div>`; });
    for (const t of order) {
      const r = f[t].slice(0, MAXR); if (!r.length) continue;
      const lim = searchType === 'all' ? 6 : 60;
      html += `<h3 class="srv-type">${{ live: 'TV en vivo', series: 'Series', vod: 'Películas' }[t]} <span class="hint">${fmtNum(f[t].length)}</span></h3>`;
      const own = a.id === S.activeId;
      const cell = (it, i) => {
        if (t !== 'live') return posterHtml(t, it, `openSearchItem(${ai},'${t}',${i})`).replace('<button class="po', `<button class="po${i >= lim ? ' more' : ''}`);
        // Guía bajo el canal: la del servidor para la cuenta activa (se pide al aparecer); para las demás, la de internet.
        let now = '';
        if (S.cfg.showEpg !== false) {
          if (own) { noteCh(it); const e = S.epg[it.stream_id]; now = `<small class="epg" data-sid="${esc(it.stream_id)}">${e ? esc(e.text) : ''}</small>${e && e.pct != null ? `<span class="p"><i style="width:${e.pct}%"></i></span>` : ''}`; }
          else if (i < lim) { const e = extNowEntry(null, { n: itemName(it), g: it.epg_channel_id || '', c: '' }); if (e) now = `<small class="epg">${esc(e.text)}</small>${e.pct != null ? `<span class="p"><i style="width:${e.pct}%"></i></span>` : ''}`; }
        }
        return `<button class="ch${i >= lim ? ' more' : ''}" onclick="openSearchItem(${ai},'live',${i})">${logoHtml(itemName(it), it.stream_icon)}<span class="n"><b>${esc(itemName(it))}</b>${now}</span>${icon('play')}</button>`;
      };
      if (t === 'live' && own && S.cfg.showEpg !== false && (!S.epgOff || extOn())) r.slice(0, lim).forEach(it => { if (!S.epg[it.stream_id]) epgQueue.push(String(it.stream_id)); });
      html += `<div class="${t === 'live' ? 'res-list' : 'grid'}">${r.map(cell).join('')}</div>`;
      if (r.length > lim) html += `<button class="btn sm more-btn" onclick="showMoreResults(this)">Ver ${fmtNum(r.length - lim)} más</button>`;
      if (f[t].length > MAXR) html += `<div class="hint" style="margin-top:6px">Se muestran los primeros ${MAXR}. Escribe una palabra más precisa para ver el resto.</div>`;
    }
    html += `</details>`;
  });
  body.innerHTML = html;
  pumpEpg();
}
// Nombre corto del servidor: "prolive.xyz:8080" → "prolive".
function serverName(a) {
  try {
    const h = new URL(a.host).hostname;
    if (/^[\d.]+$/.test(h)) return h;
    const parts = h.split('.').filter(p => !/^(www|tv|iptv|line|cdn|srv|panel)$/i.test(p));
    return parts.length > 1 ? parts[parts.length - 2] : parts[0] || h;
  } catch { return hostLabel(a.host || ''); }
}
function showMoreResults(btn) {
  const box = btn.previousElementSibling;
  if (box) box.querySelectorAll('.more').forEach(x => x.classList.remove('more'));
  btn.remove();
}
function openSearchItem(ai, type, i) {
  const f = (S.searchByAcc || [])[ai]; if (!f) return;
  const it = f[type][i]; if (!it) return;
  playHit(type, { accId: f.acc.id, item: it });
}
function playHit(type, h) {
  const sess = sessionFor(h.accId);
  if (type === 'live') {
    const it = h.item;
    nativePlay([{ name: itemName(it), url: streamUrl('live', it, sess), streamId: String(it.stream_id), isLive: true, poster: it.stream_icon || '', epgId: it.epg_channel_id || '' }], 0, `Búsqueda · ${serverName(accountById(h.accId) || {})}`, sess.apiUrl);
    return;
  }
  openDetail(type, h.item, h.accId);
}
