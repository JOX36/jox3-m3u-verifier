'use strict';
// JOX3 Verifier — Base: constantes, estado, utilidades, almacenamiento, API Xtream, cuentas y navegación.

/* ════════════════════════════════════════════════════════════════
   JOX3 Verifier — lógica de la interfaz
   Puentes nativos (Kotlin): NativeChecker, NativePlayer, NativeFiles, NativeApp
   ════════════════════════════════════════════════════════════════ */

const VERSION = '3.0';
// TV box / Android TV (se maneja con control remoto). tv.js usa el mismo valor.
window.IS_TV = (() => { try { return !!(window.NativeApp && NativeApp.isTv && NativeApp.isTv()); } catch { return false; } })() || /[?&]tv=1\b/.test(location.search);
function appVersion() { try { if (window.NativeApp && NativeApp.appVersion) return NativeApp.appVersion() || VERSION; } catch { } return VERSION; }
const TYPES = {
  live:   { label: 'En vivo',   cat: 'get_live_categories',   streams: 'get_live_streams', listCat: 'TV en Vivo' },
  vod:    { label: 'Películas', cat: 'get_vod_categories',    streams: 'get_vod_streams',  listCat: 'Películas' },
  series: { label: 'Series',    cat: 'get_series_categories', streams: 'get_series',       listCat: 'Series' },
};
const TAB_TITLES = { home: 'Inicio', live: 'En vivo', vod: 'Películas', series: 'Series', mylist: 'Mi lista' };
const SKINS = [
  { id: 'default', name: 'Cian', c: '#00D4FF' },
  { id: 'magenta', name: 'Violeta', c: '#C84BFF' },
  { id: 'matrix', name: 'Verde', c: '#00E676' },
  { id: 'fire', name: 'Naranja', c: '#FF7C00' },
  { id: 'red', name: 'Rojo', c: '#FF2244' },
  { id: 'gold', name: 'Dorado', c: '#FFC400' },
];
const CHUNK_LIST = 80;
const CHUNK_GRID = 48;
const TTL_STREAMS = 6 * 3600e3;

const S = {
  tab: 'home',
  accounts: [],
  activeId: null,
  session: null,            // cuenta activa con categorías cargadas (compatible con la versión anterior)
  cfg: {},
  myList: [],
  thumbnails: [],
  favs: {},                 // { [accountId]: { live:{id:item}, vod:{}, series:{} } }
  status: {},               // estado de canales: { [streamId]: true|false }
  onlineOnly: false,
  lists: {},                // listas en memoria: { 'live:catId': [...] }
  view: { live: null, vod: null, series: null },   // categoría elegida por pestaña
  rendered: { live: [], vod: [], series: [] },     // lo que se está mostrando (para ▶ y siguiente)
  epg: {},
  stack: [],
  detail: null,
};

/* ═══════════════════════════ UTILIDADES ═══════════════════════════ */
const $ = id => document.getElementById(id);
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function jsArg(v) { return esc(JSON.stringify(v ?? '')); }
function icon(name, cls = '') { return `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`; }
function toast(msg, type = 'info') {
  const c = $('toasts'), t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg; c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
window.toast = toast;
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fmtNum(n) { return Number(n || 0).toLocaleString('es-CO'); }
function flagEmoji(code) { if (!code || code.length !== 2) return ''; return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join(''); }
function tsDate(ts) { return ts && ts !== '0' && ts !== 'null' ? new Date(parseInt(ts, 10) * 1000) : null; }
function fmtDate(d, withTime) {
  if (!d) return 'Ilimitado';
  return d.toLocaleDateString('es-CO', withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(sec) { return new Date(sec * 1000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); }
function daysLeft(acc) { const d = tsDate(acc.expDate); return d ? Math.floor((d - Date.now()) / 86400000) : null; }
function semaforo(d) { if (d === null) return ''; if (d < 10) return '🔴'; if (d < 20) return '🟠'; return '🟢'; }
function accLevel(acc) {
  if (!acc.status) return 'muted';
  if (acc.status !== 'Active') return 'off';
  const d = daysLeft(acc);
  if (d === null) return 'on';
  if (d < 0) return 'off';
  if (d <= alertDays()) return 'warn';
  return 'on';
}
function accDaysLabel(acc, short) {
  if (!acc.status) return short ? '—' : 'Sin verificar';
  if (acc.status !== 'Active') return ({ Expired: 'Vencida', Disabled: 'Desactivada', Banned: 'Bloqueada' })[acc.status] || acc.status;
  const d = daysLeft(acc);
  if (d === null) return short ? '∞' : 'Ilimitada';
  if (d < 0) return 'Vencida';
  return short ? `${d} d` : `${d} ${d === 1 ? 'día' : 'días'}`;
}
function hostLabel(host) { try { const u = new URL(host); return u.host; } catch { return host; } }
function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function initials(name) {
  const clean = String(name || '').replace(/\b(HD|FHD|UHD|4K|SD|HEVC|H265|\d{3,4}p)\b/gi, '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const w = clean.split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 6) : w.slice(0, 2).map(x => x.slice(0, 4)).join(' ')).toUpperCase();
}
function quality(name) { const m = String(name || '').match(/\b(4K|UHD|FHD|HD)\b/i); return m ? (m[1].toUpperCase() === 'UHD' ? '4K' : m[1].toUpperCase()) : ''; }
function rating(it) {
  const r = parseFloat(it.rating) || (parseFloat(it.rating_5based) * 2) || 0;
  return r > 0 ? r.toFixed(1) : '';
}
function cleanTitle(name) { return String(name || 'Sin nombre').replace(/^\s*[A-Z]{2,3}\s*[|:-]\s*/, '').replace(/[\s\-|]*\b(4K|UHD|FHD|HD)\b\s*$/i, '').trim() || 'Sin nombre'; }
function itemId(type, it) { return String(type === 'series' ? it.series_id : it.stream_id); }
function itemName(it) { return it.name || it.title || 'Sin nombre'; }
function itemImg(type, it) { return (type === 'series' ? it.cover : it.stream_icon) || ''; }
function decodeB64(s) {
  if (!s) return '';
  try {
    const bin = atob(s); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\x00-\x08]/.test(txt) ? s : txt;
  } catch { return s; }
}
function vodExt(it) { return (it && it.container_extension) || 'mp4'; }
function copyText(txt, label = 'Copiado') {
  const done = () => toast(`📋 ${label}`, 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(fallback); else fallback();
  function fallback() {
    const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch { toast('No se pudo copiar', 'err'); } ta.remove();
  }
}
function errorState(ic, e, retryJs) {
  const retry = `<button class="btn" onclick="clearRejected();${retryJs}">${icon('refresh')}Reintentar</button>`;
  const diag = S.activeId ? `<button class="btn" onclick="runDiagnostics()">${icon('info')}Probar conexión</button>` : '';
  if (e && REJECT.has(e.status)) {
    return `<div class="empty"><div class="ic" style="color:var(--off)">${icon(ic)}</div><b>El servidor está rechazando las conexiones</b>
      <p>${esc(e.message)}. Suele pasar cuando el servidor bloquea tu IP unos minutos por recibir muchas solicitudes seguidas, o cuando la cuenta ya usa todas sus conexiones. Cierra otros reproductores con esta cuenta, espera 5 a 10 minutos y vuelve a intentar.</p>
      <div class="list-actions" style="justify-content:center">${retry}${diag}</div></div>`;
  }
  return `<div class="empty"><div class="ic">${icon(ic)}</div><b>No se pudo cargar</b><p>${esc(e ? e.message : '')}</p><div class="list-actions" style="justify-content:center">${retry}${diag}</div></div>`;
}
function emptyState(ic, title, text, btn) {
  return `<div class="empty"><div class="ic">${icon(ic)}</div><b>${esc(title)}</b><p>${esc(text)}</p>${btn || ''}</div>`;
}
const loadingHtml = (t = 'Cargando…') => `<div class="loading"><span class="spinner"></span>${esc(t)}</div>`;
// Siluetas mientras carga: se ve la forma de lo que viene, en lugar de un círculo girando.
const skelGrid = (n = 12) => `<div class="grid">${'<div class="po skel"></div>'.repeat(n)}</div>`;
const skelList = (n = 9) => `<div>${Array.from({ length: n }, () => `<div class="ch sk-row"><span class="num"></span><span class="logo skel"></span><span class="n"><b class="skel sk-l"></b><small class="skel sk-s"></small></span></div>`).join('')}</div>`;

/* ═══════════════════════════ ALMACENAMIENTO ═══════════════════════════ */
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};
function saveCfg() { store.set('jox3cfg', S.cfg); }
function saveAccounts() { store.set('jox3accounts', S.accounts); }
function saveFavs() { store.set('jox3favs', S.favs); }
function saveMyList() { store.set('jox3mylist', { items: S.myList, thumbs: S.thumbnails }); }

// Caché grande (catálogos completos) en IndexedDB; si falla, solo memoria.
const idb = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('jox3cache', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => null);
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open(); if (!db) return null;
    return new Promise(res => {
      try { const t = db.transaction('kv', mode); const r = fn(t.objectStore('kv')); t.oncomplete = () => res(r && r.result); t.onerror = () => res(null); }
      catch { res(null); }
    });
  }
  return {
    async get(k) { const v = await tx('readonly', s => s.get(k)); return v || null; },
    set(k, v) { return tx('readwrite', s => s.put(v, k)); },
    clear() { return tx('readwrite', s => s.clear()); },
  };
})();

/* ═══════════════════════════ RED / API XTREAM ═══════════════════════════ */
// Códigos con los que un panel suele indicar "te bloqueé" o "no hay conexiones libres".
const REJECT = new Set([401, 403, 404, 429, 503, 509]);
const ACTION_LABEL = {
  '': 'el acceso a la cuenta', get_live_categories: 'las categorías de TV', get_vod_categories: 'las categorías de películas',
  get_series_categories: 'las categorías de series', get_live_streams: 'los canales', get_vod_streams: 'las películas',
  get_series: 'las series', get_vod_info: 'la ficha de la película', get_series_info: 'los episodios', get_short_epg: 'la guía',
};
function actionOf(url) { try { return new URL(url).searchParams.get('action') || ''; } catch { return ''; } }
// Freno: cuando el servidor rechaza, se pausan verificaciones y guía para no empeorar un bloqueo.
function markRejected() { S.rejectedAt = Date.now(); stopChecks(); epgQueue.length = 0; }
function isRejecting() { return Date.now() - (S.rejectedAt || 0) < 3 * 60e3; }
function clearRejected() { S.rejectedAt = 0; }
async function apiGet(url, timeoutMs = 25000, opts = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
    if (!res.ok) {
      const what = ACTION_LABEL[actionOf(url)] || 'los datos';
      const err = new Error(`El servidor respondió HTTP ${res.status} al pedir ${what}`);
      err.status = res.status;
      if (REJECT.has(res.status) && !opts.noBrake && /player_api\.php/.test(url)) markRejected();
      throw err;
    }
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error('El servidor no devolvió datos válidos'); }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El servidor tardó demasiado en responder');
    if (e instanceof TypeError) throw new Error('No se pudo conectar con el servidor');
    throw e;
  } finally { clearTimeout(t); }
}
function parseM3UUrl(url) {
  url = String(url || '').trim();
  const m = url.match(/(https?:\/\/[^/\s]+)\/playlist\/([^/\s]+)\/([^/\s]+)\/m3u_plus/);
  if (m) return { host: m[1], username: decodeURIComponent(m[2]), password: decodeURIComponent(m[3]) };
  try {
    const u = new URL(url);
    const username = u.searchParams.get('username'), password = u.searchParams.get('password');
    if (!username || !password) return null;
    return { host: u.origin, username, password };
  } catch { return null; }
}
function apiUrlOf(a) { return `${a.host}/player_api.php?username=${encodeURIComponent(a.username)}&password=${encodeURIComponent(a.password)}`; }
function linksOf(a) {
  const u = encodeURIComponent(a.username), p = encodeURIComponent(a.password);
  return {
    m3u: `${a.host}/get.php?username=${u}&password=${p}&type=m3u_plus`,
    epg: `${a.host}/xmltv.php?username=${u}&password=${p}`,
    ip: a.ip ? (() => { try { const x = new URL(a.host); return `${x.protocol}//${a.ip}${x.port ? ':' + x.port : ''}/get.php?username=${u}&password=${p}&type=m3u_plus`; } catch { return ''; } })() : '',
  };
}
function streamUrl(type, it, a = S.session) {
  const base = `${a.host}`, u = a.username, p = a.password;
  if (type === 'live') {
    // Si la cuenta no permite TS pero sí HLS, se pide directamente en .m3u8.
    const f = (a.formats || (a.userInfo && a.userInfo.allowed_output_formats) || []).map(x => String(x).toLowerCase());
    const ext = f.length && !f.includes('ts') && f.includes('m3u8') ? 'm3u8' : 'ts';
    return `${base}/live/${u}/${p}/${it.stream_id}.${ext}`;
  }
  if (type === 'vod') return `${base}/movie/${u}/${p}/${it.stream_id}.${vodExt(it)}`;
  if (type === 'episode') return `${base}/series/${u}/${p}/${it.id}.${it.container_extension || 'mkv'}`;
  return `${base}/series/${u}/${p}/${it.series_id}.m3u8`;
}

/* ═══════════════════════════ CUENTAS ═══════════════════════════ */
function accountById(id) { return S.accounts.find(a => a.id === id) || null; }
function activeAccount() { return accountById(S.activeId); }
function makeId(host, user) { return `${hostLabel(host)}|${user}`.toLowerCase(); }

// Verifica una cuenta contra la API y devuelve los datos actualizados.
async function verifyAccount(p, onStep = () => { }) {
  const acc = { id: makeId(p.host, p.username), host: p.host.replace(/\/+$/, ''), username: p.username, password: p.password };
  const api = apiUrlOf(acc);
  onStep('server', 'run');
  const data = await apiGet(api).catch(e => { onStep('server', 'err', e.message); throw e; });
  if (!data || !data.user_info) { const m = 'El enlace no corresponde a una cuenta Xtream válida'; onStep('server', 'err', m); throw new Error(m); }
  const ui = data.user_info;
  if (ui.auth === 0 || ui.auth === '0') { const m = 'Usuario o contraseña incorrectos'; onStep('server', 'err', m); throw new Error(m); }
  onStep('server', 'ok', ui.status === 'Active' ? 'Cuenta activa' : `Estado: ${ui.status || 'desconocido'}`);
  Object.assign(acc, {
    status: ui.status || '', expDate: ui.exp_date || '', createdAt: ui.created_at || '', isTrial: ui.is_trial === '1' || ui.is_trial === 1,
    activeCons: ui.active_cons ?? 0, maxCons: ui.max_connections ?? 0, formats: ui.allowed_output_formats || [],
    serverTz: data.server_info?.timezone || '', checkedAt: Date.now(),
  });
  onStep('cats', 'run');
  const [live, vod, series] = await Promise.all([
    apiGet(`${api}&action=get_live_categories`).catch(() => []),
    apiGet(`${api}&action=get_vod_categories`).catch(() => []),
    apiGet(`${api}&action=get_series_categories`).catch(() => []),
  ]);
  const cats = { live: Array.isArray(live) ? live : [], vod: Array.isArray(vod) ? vod : [], series: Array.isArray(series) ? series : [] };
  acc.catCount = { live: cats.live.length, vod: cats.vod.length, series: cats.series.length };
  onStep('cats', 'ok', `${cats.live.length} de TV · ${cats.vod.length} de películas · ${cats.series.length} de series`);
  onStep('geo', 'run');
  try {
    const hn = new URL(acc.host).hostname;
    const g = await apiGet(`http://ip-api.com/json/${hn}?fields=status,timezone,city,country,countryCode,isp,query`, 8000);
    if (g && g.status === 'success') {
      acc.geo = { city: g.city, country: g.country, countryCode: g.countryCode, isp: g.isp, timezone: g.timezone };
      acc.ip = g.query && g.query !== hn ? g.query : '';
      onStep('geo', 'ok', [flagEmoji(g.countryCode), g.city, g.country].filter(Boolean).join(' '));
    } else onStep('geo', 'ok', 'Ubicación no disponible');
  } catch { onStep('geo', 'ok', 'Ubicación no disponible'); }
  idb.set(`cats:${acc.id}`, { ts: Date.now(), cats });
  return { acc, cats };
}

function upsertAccount(acc) {
  const i = S.accounts.findIndex(a => a.id === acc.id);
  if (i >= 0) S.accounts[i] = { ...S.accounts[i], ...acc, lastError: '' }; else S.accounts.unshift(acc);
  saveAccounts();
  clearTimeout(upsertAccount.t); upsertAccount.t = setTimeout(pushExpiryWatch, 800);
  return accountById(acc.id);
}

async function activateAccount(id, cats) {
  const acc = accountById(id); if (!acc) return;
  if (S.activeId !== id) {
    S.lists = {}; S.status = {}; S.epg = {}; S.view = { live: null, vod: null, series: null };
    stopChecks();
  }
  S.activeId = id; S.cfg.activeId = id; saveCfg();
  if (!cats) {
    const cached = await idb.get(`cats:${id}`);
    if (cached && cached.cats) cats = cached.cats;
  }
  S.session = buildSession(acc, cats || { live: [], vod: [], series: [] });
  for (const k in catCountryCache) delete catCountryCache[k];
  updateAppbar();
  renderAll();
  setTimeout(ensureExtEpg, 3000);
  if (!cats || Date.now() - (acc.checkedAt || 0) > 10 * 60e3) refreshActive(true);
}

function buildSession(acc, cats) {
  const l = linksOf(acc);
  return {
    id: acc.id, host: acc.host, username: acc.username, password: acc.password, apiUrl: apiUrlOf(acc),
    userInfo: { status: acc.status, exp_date: acc.expDate, active_cons: acc.activeCons, max_connections: acc.maxCons, created_at: acc.createdAt, is_trial: acc.isTrial ? '1' : '0', allowed_output_formats: acc.formats },
    categories: cats, m3uLink: l.m3u, epgLink: l.epg, ipLink: l.ip || 'N/A', geo: acc.geo || {},
  };
}

let refreshing = false;
async function refreshActive(silent) {
  const acc = activeAccount(); if (!acc || refreshing) return;
  refreshing = true; if (!silent) toast('Actualizando cuenta…');
  try {
    const { acc: fresh, cats } = await verifyAccount(acc);
    upsertAccount(fresh);
    S.session = buildSession(accountById(acc.id), cats);
    updateAppbar(); renderAll();
    setTimeout(ensureExtEpg, 3000);
    if (!silent) toast('Cuenta actualizada', 'ok');
  } catch (e) {
    if (!silent) toast(e.message, 'err');
  } finally { refreshing = false; }
}

// Confirmaciones con el estilo de la app (en lugar del cuadro gris de Android).
let confirmAction = null;
function askConfirm(title, text, okLabel, onOk, danger = true) {
  confirmAction = onOk;
  showSheet(title, `${text ? `<p class="confirm-txt">${text}</p>` : ''}
    <div class="list-actions confirm-actions">
      <button class="btn ${danger ? 'danger' : 'primary'}" onclick="runConfirm()">${danger ? icon('trash') : icon('check')}${esc(okLabel)}</button>
      <button class="btn" onclick="confirmAction=null;closeTop()">Cancelar</button>
    </div>`);
}
function runConfirm() { const fn = confirmAction; confirmAction = null; closeTop(); if (fn) fn(); }

function deleteAccount(id, sure) {
  const acc = accountById(id); if (!acc) return;
  if (!sure) { askConfirm('Eliminar cuenta', `Se borra <b>${esc(acc.username)}</b> (${esc(hostLabel(acc.host))}) y sus favoritos de este equipo.`, 'Eliminar', () => deleteAccount(id, true)); return; }
  S.accounts = S.accounts.filter(a => a.id !== id); saveAccounts();
  delete S.favs[id]; saveFavs();
  if (S.activeId === id) {
    S.activeId = null; S.session = null; S.cfg.activeId = null; saveCfg();
    if (S.accounts[0]) activateAccount(S.accounts[0].id);
  }
  while (S.stack.length && S.stack[S.stack.length - 1].id !== 'page-accounts') closeTop();
  updateAppbar(); renderAll(); toast('Cuenta eliminada');
}

/* ═══════════════════════════ NAVEGACIÓN ═══════════════════════════ */
function switchTab(tab, opts = {}) {
  if (tab === 'accounts' || !TAB_TITLES[tab]) tab = 'home';
  if (S.tab !== tab && S.tab === 'home') stopHero();
  S.tab = tab; S.cfg.lastTab = tab; saveCfg();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  updateAppbar();
  if (tab === 'live') ensureLive(opts.cat);
  if (tab === 'vod' || tab === 'series') ensureGrid(tab, opts.cat);
  if (tab === 'mylist') renderMyList();
  if (tab === 'home') renderHome();
}
// Cuentas: pantalla aparte que se abre desde Inicio o desde el selector de cuenta.
function accountsOpen() { return S.stack.some(l => l.id === 'page-accounts'); }
function openAccounts() { renderAccounts(); $('accounts-body').scrollTop = 0; showPage('page-accounts'); }
function refreshAccountsUI() {
  if (accountsOpen()) renderAccounts();
  if (S.tab === 'home') renderHomeAccount();
}

function updateAppbar() {
  const onHome = S.tab === 'home';
  $('brand').hidden = !onHome;
  $('appbar-title').hidden = onHome || !!activeAccount();
  $('appbar-title').textContent = TAB_TITLES[S.tab];
  const acc = activeAccount(), chip = $('acct-chip');
  chip.hidden = onHome || !acc;
  if (acc) {
    $('acct-chip-name').textContent = acc.username;
    $('acct-chip-days').textContent = accDaysLabel(acc, true);
    $('acct-chip-dot').className = `dot ${accLevel(acc)}`;
  }
  if (!onHome && !acc) $('appbar-title').hidden = false;
}

function renderAll() {
  if (S.tab === 'home') renderHome();
  if (accountsOpen()) renderAccounts();
  if (S.tab === 'live') ensureLive();
  if (S.tab === 'vod' || S.tab === 'series') ensureGrid(S.tab);
  if (S.tab === 'mylist') renderMyList();
}

// Pila de capas (hojas y pantallas) para que Atrás las cierre en orden.
function pushLayer(kind, id) { S.stack.push({ kind, id }); }
function showSheet(title, html) {
  $('sheet-title').textContent = title; $('sheet-body').innerHTML = html;
  if (!S.stack.some(l => l.kind === 'sheet')) pushLayer('sheet', 'sheet');
  $('sheet').classList.add('show'); $('scrim').classList.add('show');
}
function showPage(id) {
  const el = $(id);
  if (!S.stack.some(l => l.id === id)) pushLayer('page', id);
  el.style.zIndex = Math.min(49, 40 + S.stack.length);   // la última abierta siempre queda encima
  el.classList.add('show');
}
function closeTop() {
  const top = S.stack.pop(); if (!top) return false;
  if (top.kind === 'sheet') { $('sheet').classList.remove('show'); $('scrim').classList.remove('show'); stopRemoteAdd(); }
  else {
    $(top.id).classList.remove('show'); if (top.id === 'page-detail') S.detail = null;
    if (top.id === 'page-signal' && typeof sigCancel === 'function') sigCancel();   // salir detiene la prueba
  }
  return true;
}
function closeAll() { while (S.stack.length) closeTop(); }
function startTab() {
  let t = S.cfg.startTab || 'home';
  if (t === 'last') t = S.cfg.lastTab || 'home';
  return TAB_TITLES[t] ? t : 'home';
}

window.handleBack = function () {
  if (S.stack.length) { closeTop(); return true; }
  const home = startTab() === S.tab ? null : startTab();
  if (home && TAB_TITLES[home]) { switchTab(home); return true; }
  return false;
};
