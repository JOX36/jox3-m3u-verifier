'use strict';
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
const TAB_TITLES = { accounts: 'Cuentas', live: 'En vivo', vod: 'Películas', series: 'Series', mylist: 'Mi lista' };
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
const TTL_CATS = 3600e3;

const S = {
  tab: 'accounts',
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
const escHtml = esc;
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
  if (type === 'live') return `${base}/live/${u}/${p}/${it.stream_id}.ts`;
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
  updateAppbar();
  renderAll();
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
    if (!silent) toast('Cuenta actualizada', 'ok');
  } catch (e) {
    if (!silent) toast(e.message, 'err');
  } finally { refreshing = false; }
}

function deleteAccount(id) {
  const acc = accountById(id); if (!acc) return;
  if (!confirm(`¿Eliminar la cuenta ${acc.username}?`)) return;
  S.accounts = S.accounts.filter(a => a.id !== id); saveAccounts();
  delete S.favs[id]; saveFavs();
  if (S.activeId === id) {
    S.activeId = null; S.session = null; S.cfg.activeId = null; saveCfg();
    if (S.accounts[0]) activateAccount(S.accounts[0].id);
  }
  closeAll(); updateAppbar(); renderAll(); toast('Cuenta eliminada');
}

/* ═══════════════════════════ NAVEGACIÓN ═══════════════════════════ */
function switchTab(tab, opts = {}) {
  S.tab = tab; S.cfg.lastTab = tab; saveCfg();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  updateAppbar();
  if (tab === 'live') ensureLive(opts.cat);
  if (tab === 'vod' || tab === 'series') ensureGrid(tab, opts.cat);
  if (tab === 'mylist') renderMyList();
  if (tab === 'accounts') renderAccounts();
}

function updateAppbar() {
  const onAccounts = S.tab === 'accounts';
  $('appbar-title').hidden = !onAccounts && !!activeAccount();
  $('appbar-title').textContent = TAB_TITLES[S.tab];
  const acc = activeAccount(), chip = $('acct-chip');
  chip.hidden = onAccounts || !acc;
  if (acc) {
    $('acct-chip-name').textContent = acc.username;
    $('acct-chip-days').textContent = accDaysLabel(acc, true);
    $('acct-chip-dot').className = `dot ${accLevel(acc)}`;
  }
  if (!onAccounts && !acc) $('appbar-title').hidden = false;
}

function renderAll() {
  if (S.tab === 'accounts') renderAccounts();
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
  else { $(top.id).classList.remove('show'); if (top.id === 'page-detail') S.detail = null; }
  return true;
}
function closeAll() { while (S.stack.length) closeTop(); }
function startTab() { const t = S.cfg.startTab || 'accounts'; return t === 'last' ? (S.cfg.lastTab || 'accounts') : t; }

window.handleBack = function () {
  if (S.stack.length) { closeTop(); return true; }
  const home = startTab() === S.tab ? null : startTab();
  if (home && TAB_TITLES[home]) { switchTab(home); return true; }
  return false;
};

/* ═══════════════════════════ PANTALLA: CUENTAS ═══════════════════════════ */
function meterHtml(acc) {
  const d = daysLeft(acc), lvl = accLevel(acc);
  const filled = acc.status !== 'Active' ? 0 : d === null ? 30 : Math.max(0, Math.min(30, d));
  return `<div class="meter ${lvl === 'on' ? '' : lvl}">${Array.from({ length: 30 }, (_, i) => `<i class="${i < filled ? 'f' : ''}"></i>`).join('')}</div>`;
}
function renderAccounts() {
  const el = $('accounts-body'), acc = activeAccount();
  if (!S.accounts.length) {
    el.innerHTML = emptyState('tv', 'Agrega tu primera cuenta', window.IS_TV ? 'Envía el enlace M3U desde tu celular escaneando un código QR, o escríbelo con el control.' : 'Pega un enlace M3U o los datos de tu cuenta Xtream para verificarla y ver su contenido.',
      `<button class="btn primary" onclick="openAddAccount()">${icon('plus')}Agregar cuenta</button>`);
    return;
  }
  let html = '';
  if (acc) {
    const d = daysLeft(acc), exp = tsDate(acc.expDate), lvl = accLevel(acc), g = acc.geo || {};
    const badge = acc.status === 'Active' ? `<span class="badge${lvl === 'on' ? '' : ' ' + lvl}">${acc.isTrial ? 'Prueba' : 'Activa'}</span>` : `<span class="badge off">${esc(accDaysLabel(acc))}</span>`;
    const big = acc.status !== 'Active' ? '0' : d === null ? '∞' : Math.max(d, 0);
    const sub = acc.status !== 'Active' ? 'La cuenta no está activa' : d === null ? 'Sin fecha de vencimiento' : `${d === 1 ? 'día restante' : 'días restantes'}<br>vence el ${esc(fmtDate(exp))}`;
    html += `<div class="sig">
      <div class="host">${esc(hostLabel(acc.host))}${g.countryCode ? ` · ${flagEmoji(g.countryCode)} ${esc(g.city || g.country || '')}` : ''}</div>
      <div class="user">${esc(acc.username)} ${badge}</div>
      <div class="days"><b>${big}</b><span>${sub}</span></div>
      ${meterHtml(acc)}
      <div class="stats">
        <div><small>Conexiones</small><strong>${esc(acc.activeCons ?? 0)} de ${esc(acc.maxCons ?? 0)}</strong></div>
        <div><small>Categorías TV</small><strong>${fmtNum(acc.catCount?.live)}</strong></div>
        <div><small>Cat. películas</small><strong>${fmtNum(acc.catCount?.vod)}</strong></div>
      </div>
      <div class="quick">
        <button onclick="copyLink('m3u')"><span>${icon('copy')}</span>M3U</button>
        <button onclick="copyLink('epg')"><span>${icon('copy')}</span>EPG</button>
        <button onclick="copyLink('ip')"><span>${icon('link')}</span>Por IP</button>
        <button onclick="sendToTelegram()"><span>${icon('send')}</span>Telegram</button>
      </div>
      <div class="more"><button onclick="openAccountPage(${jsArg(acc.id)})">Ver todos los detalles</button></div>
    </div>`;
  }
  const others = sortByExpiry(S.accounts.filter(a => a.id !== S.activeId));
  if (others.length) {
    const sum = expirySummary(S.accounts);
    html += `<h2 class="sec">Otras cuentas <span class="hint">${others.length}</span>${S.accounts.length > 1 ? `<button onclick="verifyAll()" id="btn-verify-all">${bulk.running ? `Detener (${bulk.done} de ${bulk.total})` : 'Verificar todas'}</button>` : ''}</h2>`;
    if (sum.expired || sum.soon) html += `<div class="sum-row">
        ${sum.expired ? `<span class="badge off">${sum.expired} ${sum.expired === 1 ? 'vencida' : 'vencidas'}</span>` : ''}
        ${sum.soon ? `<span class="badge warn">${sum.soon} por vencer (${alertDays()} días o menos)</span>` : ''}
        <span class="badge">${sum.ok} al día</span>
        ${sum.expired ? `<button class="btn sm danger" onclick="deleteExpired()">${icon('trash')}Eliminar vencidas</button>` : ''}
      </div>`;
    html += others.map(a => `<button class="row" onclick="openAccountActions(${jsArg(a.id)})">
        <span class="dot ${accLevel(a)}"></span>
        <span class="n"><b>${esc(a.username)}</b><small>${esc(hostLabel(a.host))}${a.geo?.countryCode ? ' · ' + flagEmoji(a.geo.countryCode) : ''}</small></span>
        <span class="end" style="color:var(--${accLevel(a) === 'muted' ? 'muted' : accLevel(a)})">${bulk.current === a.id ? '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>' : esc(accDaysLabel(a, true))}</span>
      </button>`).join('');
  }
  html += `<button class="add-card" onclick="openAddAccount()"><span class="ic">${icon('paste')}</span><span><b>Agregar cuenta</b><small id="clip-hint">${window.IS_TV ? 'Envíala desde tu celular con un código QR' : 'Pega un enlace M3U o ingresa los datos'}</small></span></button>`;
  el.innerHTML = html;
  checkClipboardHint();
}
/* ─── Verificación masiva ─── */
const bulk = { running: false, done: 0, total: 0, current: null, stop: false };
function alertDays() { return +((S.cfg && S.cfg.alertDays) || 5); }
// Vencidas o inactivas primero, luego las que vencen antes, al final las ilimitadas y sin verificar.
function sortByExpiry(list) {
  const rank = a => {
    if (!a.status) return [3, 0];
    if (a.status !== 'Active') return [0, 0];
    const d = daysLeft(a);
    if (d === null) return [2, 0];
    if (d < 0) return [0, d];
    return [1, d];
  };
  return [...list].sort((x, y) => { const a = rank(x), b = rank(y); return a[0] - b[0] || a[1] - b[1] || x.username.localeCompare(y.username); });
}
function expirySummary(list) {
  let expired = 0, soon = 0, ok = 0;
  for (const a of list) {
    if (!a.status) continue;
    const d = daysLeft(a);
    if (a.status !== 'Active' || (d !== null && d < 0)) expired++;
    else if (d !== null && d <= alertDays()) soon++;
    else ok++;
  }
  return { expired, soon, ok };
}
// Revisa todas las cuentas guardadas, una por una con pausa, para no saturar servidores.
async function verifyAll() {
  if (bulk.running) { bulk.stop = true; toast('Deteniendo…'); return; }
  const list = sortByExpiry(S.accounts);
  Object.assign(bulk, { running: true, done: 0, total: list.length, stop: false });
  let ok = 0, fail = 0;
  for (const a of list) {
    if (bulk.stop) break;
    bulk.current = a.id; if (S.tab === 'accounts') renderAccounts();
    try {
      const { acc, cats } = await verifyAccount(a);
      upsertAccount(acc);
      if (acc.id === S.activeId) S.session = buildSession(accountById(acc.id), cats);
      ok++;
    } catch (e) {
      // Si el servidor no responde se guarda el error, sin borrar los datos anteriores.
      const cur = accountById(a.id); if (cur) { cur.lastError = e.message; cur.checkedAt = Date.now(); saveAccounts(); }
      fail++;
    }
    bulk.done++;
    await new Promise(r => setTimeout(r, 400));
  }
  Object.assign(bulk, { running: false, current: null });
  updateAppbar(); if (S.tab === 'accounts') renderAccounts();
  pushExpiryWatch();
  const sum = expirySummary(S.accounts);
  toast(`${ok} verificadas${fail ? ` · ${fail} sin respuesta` : ''}${sum.expired ? ` · ${sum.expired} vencidas` : ''}${sum.soon ? ` · ${sum.soon} por vencer` : ''}`, fail ? 'err' : 'ok');
}
function deleteExpired() {
  const exp = S.accounts.filter(a => a.status && (a.status !== 'Active' || (daysLeft(a) !== null && daysLeft(a) < 0)));
  if (!exp.length) return;
  if (!confirm(`¿Eliminar ${exp.length} ${exp.length === 1 ? 'cuenta vencida' : 'cuentas vencidas'}?\n\n${exp.map(a => a.username).join(', ')}`)) return;
  const ids = new Set(exp.map(a => a.id));
  S.accounts = S.accounts.filter(a => !ids.has(a.id)); saveAccounts();
  ids.forEach(id => delete S.favs[id]); saveFavs();
  if (ids.has(S.activeId)) { S.activeId = null; S.session = null; S.cfg.activeId = null; saveCfg(); if (S.accounts[0]) activateAccount(S.accounts[0].id); }
  updateAppbar(); renderAccounts(); pushExpiryWatch();
  toast(`${exp.length} eliminadas`, 'ok');
}

function copyLink(kind) {
  const acc = activeAccount(); if (!acc) return;
  const l = linksOf(acc);
  if (kind === 'ip' && !l.ip) { toast('Este servidor no tiene enlace por IP', 'err'); return; }
  copyText(l[kind], { m3u: 'Enlace M3U copiado', epg: 'Enlace EPG copiado', ip: 'Enlace por IP copiado' }[kind]);
}
function readClipboard() {
  try { if (window.NativeApp && NativeApp.getClipboard) return NativeApp.getClipboard() || ''; } catch { }
  return '';
}
function checkClipboardHint() {
  const clip = readClipboard(), p = parseM3UUrl(clip), hint = $('clip-hint');
  if (hint && p && !accountById(makeId(p.host, p.username))) hint.textContent = `Tienes un enlace copiado: ${p.username} en ${hostLabel(p.host)}`;
}

function openAccountActions(id) {
  const a = accountById(id); if (!a) return;
  showSheet(a.username, `
    <div class="hint" style="margin:-4px 0 8px">${esc(hostLabel(a.host))} · ${esc(accDaysLabel(a))}</div>
    <button class="menu-item" onclick="closeTop();activateAccount(${jsArg(id)})">${icon('check')}Usar esta cuenta</button>
    <button class="menu-item" onclick="closeTop();openAccountPage(${jsArg(id)})">${icon('info')}Ver detalles</button>
    <button class="menu-item" onclick="closeTop();reverify(${jsArg(id)})">${icon('refresh')}Verificar de nuevo</button>
    <button class="menu-item danger" onclick="deleteAccount(${jsArg(id)})">${icon('trash')}Eliminar cuenta</button>`);
}
async function reverify(id) {
  const a = accountById(id); if (!a) return;
  toast(`Verificando ${a.username}…`);
  try {
    const { acc, cats } = await verifyAccount(a);
    upsertAccount(acc);
    if (id === S.activeId) S.session = buildSession(accountById(id), cats);
    renderAccounts(); updateAppbar();
    toast(`${a.username}: ${accDaysLabel(accountById(id))}`, 'ok');
  } catch (e) { toast(`${a.username}: ${e.message}`, 'err'); }
}

function openAccountSwitcher() {
  const rows = S.accounts.map(a => `<button class="row" onclick="closeTop();activateAccount(${jsArg(a.id)})">
      <span class="dot ${accLevel(a)}"></span>
      <span class="n"><b>${esc(a.username)}</b><small>${esc(hostLabel(a.host))}</small></span>
      <span class="end" style="color:var(--${accLevel(a) === 'muted' ? 'muted' : accLevel(a)})">${a.id === S.activeId ? icon('check') : esc(accDaysLabel(a, true))}</span>
    </button>`).join('');
  showSheet('Cambiar de cuenta', rows + `<button class="add-card" onclick="closeTop();openAddAccount()"><span class="ic">${icon('plus')}</span><span><b>Agregar cuenta</b><small>Pega un enlace M3U o ingresa los datos</small></span></button>`);
}

function openAddAccount() {
  const clip = readClipboard(), p = parseM3UUrl(clip);
  showSheet('Agregar cuenta', `
    <div class="seg" id="add-mode">${hasRemote() ? `<button data-m="phone" onclick="setAddMode('phone')">Desde el celular</button>` : ''}<button data-m="url" onclick="setAddMode('url')">Enlace M3U</button><button data-m="manual" onclick="setAddMode('manual')">Datos</button></div>
    <div id="add-phone" hidden></div>
    <div id="add-url">
      <div class="field"><label for="m3u-url">Enlace M3U (get.php o /playlist/…/m3u_plus)</label>
        <textarea class="input" id="m3u-url" rows="3" placeholder="http://servidor:8080/get.php?username=…&password=…">${p ? esc(clip.trim()) : ''}</textarea>
        <div class="hint" style="margin-top:6px">Puedes pegar varios enlaces, uno por línea, y se verifican todos.</div></div>
      <button class="btn sm" onclick="pasteInto()" style="margin:-4px 0 14px">${icon('paste')}Pegar</button>
    </div>
    <div id="add-manual" hidden>
      <div class="field"><label for="add-host">Servidor</label><input class="input" id="add-host" placeholder="http://servidor:8080" inputmode="url" autocapitalize="off"></div>
      <div class="field"><label for="add-user">Usuario</label><input class="input" id="add-user" autocapitalize="off" autocomplete="off"></div>
      <div class="field"><label for="add-pass">Contraseña</label><input class="input" id="add-pass" autocapitalize="off" autocomplete="off"></div>
    </div>
    <button class="btn primary block" id="btn-verify" onclick="addAccountFromSheet()">Verificar cuenta</button>
    <div class="steps" id="verify-steps"></div>`);
  setAddMode(window.IS_TV && hasRemote() && !p ? 'phone' : 'url');
}
function hasRemote() { return !!(window.NativeApp && NativeApp.startRemoteAdd); }
function setAddMode(m) {
  $('add-url').hidden = m !== 'url'; $('add-manual').hidden = m !== 'manual'; $('add-phone').hidden = m !== 'phone';
  $('btn-verify').hidden = m === 'phone';
  [...$('add-mode').children].forEach(b => b.classList.toggle('on', b.dataset.m === m));
  if (m === 'phone') startRemoteAdd(); else stopRemoteAdd();
}

/* ─── Agregar desde el celular: QR con un mini servidor en la red local ─── */
function startRemoteAdd() {
  const box = $('add-phone'); if (!box) return;
  let r = {};
  try { r = JSON.parse(NativeApp.startRemoteAdd() || '{}'); } catch { r = { error: 'No se pudo iniciar' }; }
  if (r.error) { box.innerHTML = `<div class="hint" style="color:var(--warn);margin-bottom:12px">${esc(r.error)}</div>`; return; }
  S.remoteActive = true;
  box.innerHTML = `<div class="remote">
      ${r.qr ? `<img class="qr" src="data:image/png;base64,${r.qr}" alt="Código QR">` : ''}
      <div class="remote-txt"><b>Escanea con la cámara del celular</b>
        <p>El celular debe estar en la misma red WiFi. Se abre una página donde pegas uno o varios enlaces M3U y llegan aquí solos.</p>
        <small>O escribe en el navegador del celular:</small><code>${esc(r.url)}</code></div>
    </div><div class="steps" id="remote-steps"></div>`;
}
function stopRemoteAdd() {
  if (!S.remoteActive) return;
  S.remoteActive = false;
  try { NativeApp.stopRemoteAdd(); } catch { }
}
let remoteQueue = Promise.resolve();
window.onRemoteAdd = function (json) {
  let items = []; try { items = JSON.parse(json); } catch { return; }
  toast(`Recibido del celular: ${items.length} ${items.length === 1 ? 'cuenta' : 'cuentas'}`, 'ok');
  items.forEach(it => { remoteQueue = remoteQueue.then(() => addRemoteItem(it)); });
};
async function addRemoteItem(it) {
  let p = null;
  if (it.type === 'url') p = parseM3UUrl(it.url);
  else {
    let host = String(it.host || '').trim().replace(/\/+$/, '');
    if (host && !/^https?:\/\//i.test(host)) host = 'http://' + host;
    try { p = { host: new URL(host).origin, username: it.user, password: it.pass }; } catch { p = null; }
  }
  const steps = $('remote-steps');
  const row = document.createElement('div');
  const label = p ? `${p.username} · ${hostLabel(p.host)}` : String(it.url || it.host || 'Enlace');
  row.innerHTML = `<span class="st"><span class="spinner"></span></span>Verificando ${esc(label)}…`;
  if (steps) steps.prepend(row);
  if (!p) { row.className = 'err'; row.innerHTML = `<span class="st">${icon('close')}</span>${esc(label)}: el enlace no tiene usuario y contraseña`; return; }
  try {
    const { acc, cats } = await verifyAccount(p);
    upsertAccount(acc);
    if (!S.activeId) await activateAccount(acc.id, cats);
    row.className = acc.status === 'Active' ? 'ok' : 'err';
    row.innerHTML = `<span class="st">${icon(acc.status === 'Active' ? 'check' : 'close')}</span>${esc(label)}: ${esc(accDaysLabel(acc))}`;
    if (S.tab === 'accounts') renderAccounts();
  } catch (e) {
    row.className = 'err'; row.innerHTML = `<span class="st">${icon('close')}</span>${esc(label)}: ${esc(e.message)}`;
  }
}
function pasteInto() {
  const clip = readClipboard();
  if (clip) { $('m3u-url').value = clip.trim(); return; }
  if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(t => { $('m3u-url').value = t.trim(); }).catch(() => toast('No hay nada copiado', 'err'));
  else toast('No hay nada copiado', 'err');
}
async function addAccountFromSheet() {
  let p;
  if (!$('add-url').hidden) {
    // Varios enlaces (uno por línea): se verifican todos, uno tras otro.
    const links = $('m3u-url').value.split(/[\s,]+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x));
    if (links.length > 1) { addManyFromSheet(links); return; }
    p = parseM3UUrl($('m3u-url').value);
    if (!p) { toast('El enlace no tiene usuario y contraseña. Revisa que esté completo.', 'err'); return; }
  } else {
    let host = $('add-host').value.trim().replace(/\/+$/, '');
    if (host && !/^https?:\/\//i.test(host)) host = 'http://' + host;
    const username = $('add-user').value.trim(), password = $('add-pass').value.trim();
    if (!host || !username || !password) { toast('Completa servidor, usuario y contraseña', 'err'); return; }
    try { host = new URL(host).origin; } catch { toast('El servidor no es una dirección válida', 'err'); return; }
    p = { host, username, password };
  }
  const btn = $('btn-verify'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Verificando…';
  const labels = { server: 'Conectando con el servidor', cats: 'Cargando categorías', geo: 'Ubicando el servidor' };
  const steps = $('verify-steps'); steps.innerHTML = '';
  const onStep = (k, st, msg) => {
    let row = steps.querySelector(`[data-k="${k}"]`);
    if (!row) { row = document.createElement('div'); row.dataset.k = k; steps.appendChild(row); }
    row.className = st === 'ok' ? 'ok' : st === 'err' ? 'err' : '';
    row.innerHTML = `<span class="st">${st === 'run' ? '<span class="spinner"></span>' : st === 'ok' ? icon('check') : icon('close')}</span>${esc(msg || labels[k])}`;
  };
  try {
    const { acc, cats } = await verifyAccount(p, onStep);
    upsertAccount(acc);
    await activateAccount(acc.id, cats);
    closeTop();
    toast(acc.status === 'Active' ? `Cuenta verificada: ${accDaysLabel(acc)}` : `Cuenta guardada (${acc.status})`, acc.status === 'Active' ? 'ok' : 'err');
    switchTab('accounts');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if ($('btn-verify')) { btn.disabled = false; btn.textContent = 'Verificar cuenta'; }
  }
}

async function addManyFromSheet(links) {
  links = [...new Set(links)];
  const btn = $('btn-verify'); btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>Verificando ${links.length} cuentas…`;
  const steps = $('verify-steps'); steps.innerHTML = '';
  let ok = 0;
  for (const l of links) {
    const p = parseM3UUrl(l);
    const row = document.createElement('div');
    const label = p ? `${p.username} · ${hostLabel(p.host)}` : l.slice(0, 60);
    row.innerHTML = `<span class="st"><span class="spinner"></span></span>${esc(label)}…`; steps.appendChild(row);
    if (!p) { row.className = 'err'; row.innerHTML = `<span class="st">${icon('close')}</span>${esc(label)}: sin usuario y contraseña`; continue; }
    try {
      const { acc, cats } = await verifyAccount(p);
      upsertAccount(acc); ok++;
      if (!S.activeId) await activateAccount(acc.id, cats);
      row.className = acc.status === 'Active' ? 'ok' : 'err';
      row.innerHTML = `<span class="st">${icon(acc.status === 'Active' ? 'check' : 'close')}</span>${esc(label)}: ${esc(accDaysLabel(acc))}`;
    } catch (e) { row.className = 'err'; row.innerHTML = `<span class="st">${icon('close')}</span>${esc(label)}: ${esc(e.message)}`; }
    await new Promise(r => setTimeout(r, 300));
  }
  if ($('btn-verify')) { btn.disabled = false; btn.textContent = 'Verificar cuenta'; }
  pushExpiryWatch();
  if (S.tab === 'accounts') renderAccounts();
  toast(`${ok} de ${links.length} cuentas guardadas`, ok ? 'ok' : 'err');
}

function openAccountPage(id) {
  const a = accountById(id); if (!a) return;
  const l = linksOf(a), g = a.geo || {}, exp = tsDate(a.expDate), created = tsDate(a.createdAt);
  const cats = id === S.activeId && S.session ? { live: catsOf('live'), vod: catsOf('vod'), series: catsOf('series') } : null;
  $('account-page-title').textContent = a.username;
  const linkRow = (label, url, kind) => url ? `<div class="link-row"><div><small>${label}</small><code>${esc(url)}</code></div><button onclick='copyText(${JSON.stringify(url).replace(/'/g, "&#39;")}, ${JSON.stringify(label + " copiado")})' aria-label="Copiar">${icon('copy')}</button></div>` : '';
  const catBlock = (type, title) => {
    const list = cats?.[type] || []; if (!list.length) return '';
    return `<h2 class="sec">${title} <span class="hint">${list.length}</span></h2><div class="cat-list">${list.slice(0, 80).map(c =>
      `<button onclick="closeAll();switchTab('${type}',{cat:${jsArg(String(c.category_id))}})">${esc(c.category_name || 'Sin nombre')}</button>`).join('')}${list.length > 80 ? `<span class="hint">y ${list.length - 80} más</span>` : ''}</div>`;
  };
  $('account-body').innerHTML = `
    <dl class="kv">
      <dt>Servidor</dt><dd>${esc(a.host)}</dd>
      <dt>Usuario</dt><dd>${esc(a.username)}</dd>
      <dt>Contraseña</dt><dd>${esc(a.password)}</dd>
      <dt>Estado</dt><dd>${esc(a.status || 'Sin verificar')}${a.isTrial ? ' (prueba)' : ''}</dd>
      <dt>Conexiones</dt><dd>${esc(a.activeCons ?? 0)} de ${esc(a.maxCons ?? 0)}</dd>
      <dt>Creada</dt><dd>${created ? esc(fmtDate(created, true)) : 'N/A'}</dd>
      <dt>Vence</dt><dd>${esc(fmtDate(exp, true))}</dd>
      <dt>Días restantes</dt><dd>${esc(accDaysLabel(a))} ${semaforo(daysLeft(a))}</dd>
      <dt>Ubicación</dt><dd>${g.countryCode ? flagEmoji(g.countryCode) + ' ' : ''}${esc([g.city, g.country].filter(Boolean).join(', ') || 'N/A')}</dd>
      <dt>Zona horaria</dt><dd>${esc(g.timezone || a.serverTz || 'N/A')}</dd>
      <dt>Proveedor</dt><dd>${esc(g.isp || 'N/A')}</dd>
      <dt>Formatos</dt><dd>${esc((a.formats || []).join(', ') || 'N/A')}</dd>
      <dt>Verificada</dt><dd>${a.checkedAt ? esc(fmtDate(new Date(a.checkedAt), true)) : 'Nunca'}</dd>
    </dl>
    <h2 class="sec">Enlaces</h2>
    ${linkRow('Enlace M3U', l.m3u)}${linkRow('Enlace EPG', l.epg)}${linkRow('M3U por IP', l.ip)}
    <div class="list-actions" style="margin-top:12px">
      ${id !== S.activeId ? `<button class="btn sm primary" onclick="closeTop();activateAccount(${jsArg(id)})">${icon('check')}Usar esta cuenta</button>` : ''}
      <button class="btn sm" onclick="${id === S.activeId ? 'refreshActive()' : `reverify(${jsArg(id)})`}">${icon('refresh')}Verificar de nuevo</button>
      ${id === S.activeId ? `<button class="btn sm" onclick="runDiagnostics()">${icon('info')}Probar conexión</button>` : ''}
      ${id === S.activeId ? `<button class="btn sm" onclick="sendToTelegram()">${icon('send')}Telegram</button>` : ''}
      <button class="btn sm danger" onclick="deleteAccount(${jsArg(id)})">${icon('trash')}Eliminar</button>
    </div>
    ${catBlock('live', 'Categorías de TV')}${catBlock('vod', 'Categorías de películas')}${catBlock('series', 'Categorías de series')}`;
  showPage('page-account');
}

/* ═══════════════════════════ CONTROL PARENTAL ═══════════════════════════ */
// Con PIN. Oculta categorías de adultos (detectadas por nombre) y las que el usuario elija,
// en listas, búsqueda, favoritos y "Continuar viendo". Se desbloquea por 1 hora.
const ADULT_RX = /(^|[^a-z0-9])(adult[oa]?s?|xxx+|\+ ?18|18 ?\+|porn[a-z]*|er[oó]tic[oa]?s?|playboy|brazzers|hustler|penthouse|dorcel|vivid|private|venus|sexy?|hot ?club|red ?light)([^a-z0-9]|$)/i;
S.accCats = {};
function pc() { return S.cfg.parental || (S.cfg.parental = {}); }
function parentalOn() { return !!(S.cfg.parental && S.cfg.parental.on); }
function parentalLocked() {
  if (!parentalOn()) return false;
  if (S.parentalUntil && Date.now() < S.parentalUntil) return false;
  return true;
}
function catSet(kind, accId, type) { const p = pc(); p[kind] = p[kind] || {}; p[kind][accId] = p[kind][accId] || {}; return (p[kind][accId][type] = p[kind][accId][type] || []); }
function catBlocked(type, cat, accId = S.activeId) {
  if (!cat) return false;
  const id = String(cat.category_id);
  if (catSet('blocked', accId, type).includes(id)) return true;
  if (catSet('allowed', accId, type).includes(id)) return false;
  return pc().auto !== false && ADULT_RX.test(cat.category_name || '');
}
async function loadAccCats(accId) {
  if (accId === S.activeId || S.accCats[accId]) return;
  const c = await idb.get(`cats:${accId}`); S.accCats[accId] = (c && c.cats) || { live: [], vod: [], series: [] };
}
function filterAllowed(type, items, accId = S.activeId) {
  if (!parentalLocked()) return items;
  const cats = accId === S.activeId ? allCatsOf(type) : ((S.accCats[accId] || {})[type] || []);
  const blocked = new Set(cats.filter(c => catBlocked(type, c, accId)).map(c => String(c.category_id)));
  return items.filter(it => !blocked.has(String(it.category_id)) && !(pc().auto !== false && ADULT_RX.test(itemName(it))));
}
// PIN guardado como huella (no en texto): suficiente para un bloqueo familiar.
function pinHash(pin, salt) {
  let h = 2166136261 >>> 0;
  for (const ch of `${salt}:${pin}:jox3`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  for (let i = 0; i < 5000; i++) { h ^= h >>> 13; h = Math.imul(h, 2246822507) >>> 0; h ^= i; }
  return h.toString(16);
}
// Teclado numérico (sirve con el dedo, con el control del TV y con teclado físico).
function pinPad(title, hint, onDone) {
  S.pinBuf = ''; S.pinDone = onDone;
  showSheet(title, `<div class="hint" style="margin:-4px 0 12px" id="pin-hint">${esc(hint)}</div>
    <div class="pin-dots" id="pin-dots">${'<i></i>'.repeat(4)}</div>
    <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button onclick="pinKey('${n}')">${n}</button>`).join('')}
      <button onclick="pinKey('del')" aria-label="Borrar">${icon('back')}</button><button onclick="pinKey('0')">0</button><button onclick="pinKey('ok')" aria-label="Aceptar">${icon('check')}</button></div>`);
}
function pinKey(k) {
  if (k === 'del') S.pinBuf = S.pinBuf.slice(0, -1);
  else if (k === 'ok') { if (S.pinBuf.length === 4) S.pinDone(S.pinBuf); return; }
  else if (S.pinBuf.length < 4) S.pinBuf += k;
  const dots = $('pin-dots'); if (dots) [...dots.children].forEach((d, i) => d.classList.toggle('on', i < S.pinBuf.length));
  if (S.pinBuf.length === 4) setTimeout(() => S.pinDone && S.pinBuf.length === 4 && S.pinDone(S.pinBuf), 150);
}
document.addEventListener('keydown', e => {
  if (!$('pin-dots') || !$('sheet').classList.contains('show')) return;
  if (/^[0-9]$/.test(e.key)) { pinKey(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { pinKey('del'); e.preventDefault(); }
});
function pinError(msg) {
  S.pinBuf = ''; const d = $('pin-dots'); if (!d) return;
  [...d.children].forEach(x => x.classList.remove('on'));
  d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
  $('pin-hint').textContent = msg; $('pin-hint').style.color = 'var(--off)';
}
function askPin(title, onOk) {
  pinPad(title, 'Ingresa el PIN de 4 dígitos', pin => {
    if (pinHash(pin, pc().salt) === pc().pin) { closeTop(); onOk(); }
    else pinError('PIN incorrecto. Intenta de nuevo.');
  });
}
function askUnlock(after) {
  askPin('Desbloquear contenido', () => {
    S.parentalUntil = Date.now() + 3600e3;
    toast('Desbloqueado por 1 hora', 'ok');
    resetCatalogViews();
    if (after) after();
  });
}
function lockNow() { S.parentalUntil = 0; toast('Control parental bloqueado'); resetCatalogViews(); }
function resetCatalogViews() { S.view = { live: null, vod: null, series: null }; renderAll(); if ($('page-settings').classList.contains('show')) openSettings(); }
// Cambiar ajustes del control parental exige el PIN si está bloqueado.
function withParental(fn) { if (parentalLocked()) askUnlock(fn); else fn(); }
function setupParental() {
  pinPad('Crear PIN', 'Elige un PIN de 4 dígitos. Lo pedirá la app para ver el contenido oculto.', first => {
    pinPad('Confirmar PIN', 'Ingresa el mismo PIN otra vez', second => {
      if (second !== first) { pinError('No coincide. Vuelve a empezar.'); setTimeout(setupParental, 900); return; }
      const p = pc(); p.salt = Math.random().toString(36).slice(2, 10); p.pin = pinHash(first, p.salt); p.on = true; if (p.auto === undefined) p.auto = true;
      saveCfg(); S.parentalUntil = 0; closeTop();
      toast('Control parental activado', 'ok'); resetCatalogViews();
    });
  });
}
function disableParental() {
  withParental(() => { if (!confirm('¿Desactivar el control parental?')) return; const p = pc(); p.on = false; saveCfg(); toast('Control parental desactivado'); resetCatalogViews(); });
}
function changePin() { withParental(() => setupParental()); }
function toggleAutoAdult() { withParental(() => { pc().auto = pc().auto === false; saveCfg(); resetCatalogViews(); }); }
function openBlockedCats() {
  withParental(() => {
    if (!S.session) { toast('Primero elige una cuenta', 'err'); return; }
    S.pcType = S.pcType || 'live';
    renderBlockedCats();
  });
}
function renderBlockedCats() {
  const t = S.pcType, cats = allCatsOf(t);
  showSheet('Categorías bloqueadas', `
    <div class="hint" style="margin:-4px 0 10px">Cuenta ${esc(activeAccount()?.username || '')}. Las marcadas se ocultan cuando el control está bloqueado. Las de adultos vienen marcadas solas.</div>
    <div class="seg">${['live', 'vod', 'series'].map(k => `<button class="${k === t ? 'on' : ''}" onclick="S.pcType='${k}';renderBlockedCats()">${TYPES[k].label}</button>`).join('')}</div>
    ${cats.length ? cats.map(c => { const b = catBlocked(t, c); return `<button class="set-row" onclick="toggleCatBlock('${t}',${jsArg(String(c.category_id))})"><span class="n"><b>${esc(c.category_name || 'Sin nombre')}</b>${ADULT_RX.test(c.category_name || '') ? '<small>Detectada como contenido para adultos</small>' : ''}</span><span class="switch${b ? ' on' : ''}"></span></button>`; }).join('') : '<div class="hint">Sin categorías.</div>'}`);
}
function toggleCatBlock(type, id) {
  const cat = allCatsOf(type).find(c => String(c.category_id) === id); if (!cat) return;
  const bl = catSet('blocked', S.activeId, type), al = catSet('allowed', S.activeId, type);
  const was = catBlocked(type, cat);
  const rm = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); };
  rm(bl, id); rm(al, id);
  const auto = pc().auto !== false && ADULT_RX.test(cat.category_name || '');
  if (was && auto) al.push(id); else if (!was && !auto) bl.push(id);
  saveCfg();
  const top = $('sheet-body').scrollTop; renderBlockedCats(); $('sheet-body').scrollTop = top;
  S.view = { live: null, vod: null, series: null };
}

/* ═══════════════════════════ DIAGNÓSTICO ═══════════════════════════ */
let diagResolve = null;
async function runDiagnostics() {
  const acc = activeAccount(); if (!acc || !S.session) { toast('Primero elige una cuenta', 'err'); return; }
  clearRejected(); stopChecks();
  showSheet('Probar conexión', `<div class="hint" style="margin-bottom:6px">Hace unas pocas solicitudes al servidor, una por una, para ver qué responde.</div><div class="steps" id="diag-steps"></div><div id="diag-result" style="margin-top:14px"></div>`);
  const steps = $('diag-steps'), api = S.session.apiUrl, out = [];
  const add = (label) => { const d = document.createElement('div'); d.innerHTML = `<span class="st"><span class="spinner"></span></span>${esc(label)}`; steps.appendChild(d); return d; };
  const done = (row, ok, label) => { row.className = ok ? 'ok' : 'err'; row.innerHTML = `<span class="st">${icon(ok ? 'check' : 'close')}</span>${esc(label)}`; };
  async function step(label, fn) {
    const row = add(label), t0 = Date.now();
    try { const msg = await fn(); done(row, true, `${label}: ${msg} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); out.push({ ok: true }); return true; }
    catch (e) { done(row, false, `${label}: ${e.message}`); out.push({ ok: false, status: e.status }); return false; }
  }
  const cat = (catsOf('live')[0] || {}).category_id;
  let firstChannel = null;
  await step('Acceso a la cuenta', async () => { const d = await apiGet(api, 15000, { noBrake: true }); if (!d.user_info) throw new Error('respuesta inválida'); return d.user_info.status || 'ok'; });
  await step('Categorías de TV', async () => { const d = await apiGet(`${api}&action=get_live_categories`, 15000, { noBrake: true }); return `${(d || []).length} categorías`; });
  if (cat !== undefined) await step('Canales de la primera categoría', async () => { const d = await apiGet(`${api}&action=get_live_streams&category_id=${encodeURIComponent(cat)}`, 20000, { noBrake: true }); firstChannel = (d || [])[0]; return `${(d || []).length} canales`; });
  const vcat = (catsOf('vod')[0] || {}).category_id;
  if (vcat !== undefined) await step('Películas de la primera categoría', async () => { const d = await apiGet(`${api}&action=get_vod_streams&category_id=${encodeURIComponent(vcat)}`, 20000, { noBrake: true }); return `${(d || []).length} películas`; });
  if (firstChannel && window.NativeChecker) {
    await step(`Abrir el canal ${itemName(firstChannel)}`, () => new Promise((res, rej) => {
      const t = setTimeout(() => { diagResolve = null; rej(new Error('sin respuesta')); }, 15000);
      diagResolve = ok => { clearTimeout(t); diagResolve = null; ok ? res('responde') : rej(new Error('no responde')); };
      NativeChecker.checkStream(streamUrl('live', firstChannel), '__diag__');
    }));
  }
  const apiFail = out.slice(0, -1).some(x => !x.ok) || (out.length && !out[out.length - 1].ok && !firstChannel);
  const anyReject = out.some(x => REJECT.has(x.status));
  const allOk = out.every(x => x.ok);
  $('diag-result').innerHTML = allOk
    ? `<div class="tg-status" style="color:var(--on)">${icon('check')}Todo responde bien. Si algo falló antes, era un bloqueo pasajero.</div>`
    : anyReject
      ? `<div class="hint" style="color:var(--text)">El servidor está rechazando las solicitudes. Lo más probable es un bloqueo temporal de tu IP o que la cuenta tenga todas sus conexiones ocupadas. Cierra otros reproductores con esta cuenta y vuelve a probar en 5 a 10 minutos.</div>`
      : apiFail ? `<div class="hint" style="color:var(--text)">El servidor no responde bien. Revisa tu internet o prueba más tarde.</div>`
        : `<div class="hint" style="color:var(--text)">La cuenta responde, pero el canal no abre. Puede que las conexiones estén en uso o que ese canal esté caído.</div>`;
}

/* ═══════════════════════════ CATÁLOGO ═══════════════════════════ */
function allCatsOf(type) { return (S.session && S.session.categories[type]) || []; }
// Categorías visibles: con el control parental bloqueado se ocultan las de adultos y las elegidas.
function catsOf(type) { const all = allCatsOf(type); return parentalLocked() ? all.filter(c => !catBlocked(type, c)) : all; }

// Lista de una categoría (o de todo el tipo con catId = '*'), con caché.
async function getList(type, catId) {
  if (!S.session) return [];
  const key = `${type}:${catId}`;
  if (S.lists[key]) return S.lists[key];
  const dbKey = `list:${S.session.id}:${key}`;
  const cached = await idb.get(dbKey);
  if (cached && Date.now() - cached.ts < TTL_STREAMS && Array.isArray(cached.items)) { S.lists[key] = cached.items; return cached.items; }
  // Si ya tenemos la lista completa, se filtra sin pedir nada al servidor.
  if (catId !== '*' && S.lists[`${type}:*`]) {
    const items = S.lists[`${type}:*`].filter(i => String(i.category_id) === String(catId));
    S.lists[key] = items; return items;
  }
  const url = `${S.session.apiUrl}&action=${TYPES[type].streams}${catId !== '*' ? `&category_id=${encodeURIComponent(catId)}` : ''}`;
  const data = await apiGet(url, catId === '*' ? 90000 : 30000);
  const items = Array.isArray(data) ? data : [];
  S.lists[key] = items;
  idb.set(dbKey, { ts: Date.now(), items });
  return items;
}

/* ─── Favoritos ─── */
function favMap(type, accId) {
  const id = accId || S.activeId || '_'; S.favs[id] = S.favs[id] || { live: {}, vod: {}, series: {} };
  return S.favs[id][type] = S.favs[id][type] || {};
}
function isFav(type, it, accId) { return !!favMap(type, accId)[itemId(type, it)]; }
function toggleFav(type, it, btn, accId) {
  const m = favMap(type, accId), id = itemId(type, it);
  if (m[id]) { delete m[id]; toast('Quitado de favoritos'); }
  else {
    const keep = { name: it.name, stream_id: it.stream_id, series_id: it.series_id, stream_icon: it.stream_icon, cover: it.cover, category_id: it.category_id, rating: it.rating, rating_5based: it.rating_5based, container_extension: it.container_extension, epg_channel_id: it.epg_channel_id, num: it.num };
    m[id] = keep; toast('Añadido a favoritos', 'ok');
  }
  saveFavs();
  if (btn) { btn.classList.toggle('on', !!m[id]); btn.innerHTML = icon(m[id] ? 'star' : 'star-o'); }
  return !!m[id];
}

/* ═══════════════════════════ PANTALLA: EN VIVO ═══════════════════════════ */
let liveObserver = null, epgObserver = null;
function noAccountHtml() {
  return emptyState('acc', 'Primero agrega una cuenta', 'Verifica una cuenta en la pestaña Cuentas para ver su contenido aquí.',
    `<button class="btn primary" onclick="switchTab('accounts');openAddAccount()">${icon('plus')}Agregar cuenta</button>`);
}
function chipsHtml(type, current) {
  const cats = catsOf(type);
  const chip = (key, label, extra = '') => `<button class="chip${String(current) === String(key) ? ' on' : ''}" data-cat="${esc(key)}" onclick="selectCat('${type}',${jsArg(String(key))})">${extra}${esc(label)}</button>`;
  return chip('*', 'Categorías', icon('folder')) + chip('fav', 'Favoritos', icon('star')) + cats.map(c => chip(c.category_id, c.category_name || 'Sin nombre')).join('');
}
function defaultCat(type) {
  const saved = S.cfg[`cat_${S.activeId}_${type}`];
  if (saved && (saved === 'fav' || saved === '*' || catsOf(type).some(c => String(c.category_id) === String(saved)))) return saved;
  return '*';
}
function categoryCounts(type) {
  const all = S.lists[`${type}:*`]; if (!all) return null;
  const c = {}; for (const it of all) c[it.category_id] = (c[it.category_id] || 0) + 1; return c;
}
function categoryListHtml(type) {
  const cats = catsOf(type), counts = categoryCounts(type), favN = Object.keys(favMap(type)).length;
  if (!cats.length) return emptyState('folder', 'Sin categorías', 'Este servidor no tiene categorías de este tipo.');
  const row = (key, name, sub, ic) => `<button class="row cat-row" data-name="${esc(String(name).toLowerCase())}" onclick="selectCat('${type}',${jsArg(String(key))})">
      <span class="cat-ic">${icon(ic)}</span><span class="n"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${icon('chev', 'chev')}</button>`;
  return `${cats.length > 10 ? `<div class="search">${icon('search')}<input type="text" placeholder="Buscar categoría" oninput="filterCatRows(this)" autocomplete="off"></div>` : ''}
    ${parentalLocked() && allCatsOf(type).length > cats.length ? `<button class="row cat-row" onclick="askUnlock()"><span class="cat-ic" style="color:var(--warn)">${icon('lock')}</span><span class="n"><b>${allCatsOf(type).length - cats.length} ${allCatsOf(type).length - cats.length === 1 ? 'categoría oculta' : 'categorías ocultas'}</b><small>Control parental activo · toca para desbloquear</small></span>${icon('chev', 'chev')}</button>` : ''}
    <div class="cat-rows">${favN ? row('fav', 'Favoritos', `${favN} guardados`, 'star') : ''}
    ${cats.map(c => row(c.category_id, c.category_name || 'Sin nombre', counts ? `${fmtNum(counts[c.category_id] || 0)} ${type === 'live' ? 'canales' : type === 'vod' ? 'películas' : 'series'}` : '', 'folder')).join('')}</div>`;
}
function filterCatRows(inp) {
  const q = inp.value.trim().toLowerCase();
  inp.closest('.scroll').querySelectorAll('.cat-row').forEach(r => { r.hidden = q && !r.dataset.name.includes(q); });
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
  body.innerHTML = loadingHtml('Cargando canales…');
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
  if (!list) return `<span class="g-empty">${S.epgOff ? 'Sin guía' : 'Cargando guía…'}</span>`;
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
  while (guideActive < 2 && guideQueue.length && !S.epgOff && !isRejecting()) {
    const sid = guideQueue.shift(); if (S.epgFull[sid]) continue;
    guideActive++;
    fetchEpgFull(sid).finally(() => { guideActive--; setTimeout(pumpGuide, 350); });
  }
  if (S.epgOff) document.querySelectorAll('.g-line .g-empty').forEach(e => { e.textContent = 'Sin guía'; });
}
async function fetchEpgFull(sid) {
  if (!S.session) return;
  const accId = S.session.id;
  let list = [];
  try {
    const d = await apiGet(`${S.session.apiUrl}&action=get_short_epg&stream_id=${encodeURIComponent(sid)}&limit=14`, 12000, { noBrake: true });
    list = (d.epg_listings || []).map(x => ({ t: decodeB64(x.title).trim(), d: decodeB64(x.description || '').trim(), s: +x.start_timestamp || 0, e: +x.stop_timestamp || 0 }))
      .filter(x => x.t && x.e > x.s).sort((a, b) => a.s - b.s);
  } catch (e) { if (e && REJECT.has(e.status)) S.epgOff = true; }
  if (!S.session || S.session.id !== accId) return;
  S.epgFull[sid] = list;
  // También alimenta la línea "Ahora" de la vista de lista.
  const now = Date.now() / 1000, cur = list.find(p => p.s <= now && p.e > now);
  if (cur && !S.epg[sid]) S.epg[sid] = { text: `Ahora: ${cur.t} · ${fmtTime(cur.s)}`, pct: Math.round((now - cur.s) / (cur.e - cur.s) * 100) };
  document.querySelectorAll(`.g-line[data-sid="${CSS.escape(String(sid))}"]`).forEach(el => {
    const idx = S.rendered.live.findIndex(it => String(it.stream_id) === String(sid));
    el.innerHTML = guideBlocks(sid, idx);
  });
}
function openProgram(sid, k, idx) {
  const p = (S.epgFull[sid] || [])[k]; if (!p) return;
  const it = S.rendered.live[idx], now = Date.now() / 1000;
  const live = p.s <= now && p.e > now, past = p.e <= now;
  const day = new Date(p.s * 1000).toDateString() === new Date().toDateString() ? 'Hoy' : new Date(p.s * 1000).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric' });
  const pct = live ? Math.round((now - p.s) / (p.e - p.s) * 100) : 0;
  showSheet(p.t, `
    <div class="hint" style="margin:-4px 0 10px">${esc(it ? itemName(it) : '')} · ${esc(day)} ${fmtTime(p.s)} – ${fmtTime(p.e)}${live ? ' · <b style="color:var(--off)">EN VIVO</b>' : past ? ' · ya terminó' : ''}</div>
    ${live ? `<div class="upd-bar" style="margin:0 0 12px"><i style="width:${pct}%"></i></div>` : ''}
    ${p.d ? `<p class="syn" style="margin-top:0">${esc(p.d)}</p>` : '<div class="hint">Sin descripción.</div>'}
    <div class="list-actions" style="margin-top:16px">
      ${it ? `<button class="btn primary" onclick="closeTop();playLive(${idx})">${icon('play')}${live ? 'Ver ahora' : 'Ver el canal'}</button>` : ''}
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
function pumpEpg() {
  while (epgActive < 1 && epgQueue.length && !S.epgOff && !isRejecting()) {
    const sid = epgQueue.shift(); if (S.epg[sid]) continue;
    epgActive++;
    fetchEpg(sid).finally(() => { epgActive--; setTimeout(pumpEpg, 700); });
  }
}
async function fetchEpg(sid) {
  if (!S.session) return;
  const accId = S.session.id;
  let entry = { text: 'Sin guía disponible', pct: null };
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
    if (e && REJECT.has(e.status)) { S.epgOff = true; return; }   // el servidor no da guía: no insistir
  }
  if (!S.session || S.session.id !== accId) return;
  S.epg[sid] = entry;
  document.querySelectorAll(`small.epg[data-sid="${CSS.escape(String(sid))}"]`).forEach(el => {
    el.textContent = entry.text;
    const n = el.parentNode; if (entry.pct != null && !n.querySelector('.p')) n.insertAdjacentHTML('beforeend', `<span class="p"><i style="width:${entry.pct}%"></i></span>`);
  });
}

function playLive(i) {
  const items = S.rendered.live; if (!items[i]) return;
  // Para listas enormes se envía una ventana alrededor del canal elegido.
  const MAXP = 1500; let start = 0, slice = items;
  if (items.length > MAXP) { start = Math.max(0, i - MAXP / 2); slice = items.slice(start, start + MAXP); }
  const label = S.view.live === 'fav' ? 'Favoritos' : S.view.live === '*' ? 'TV en Vivo' : (catsOf('live').find(c => String(c.category_id) === String(S.view.live))?.category_name || 'TV en Vivo');
  nativePlay(slice.map(it => ({ name: itemName(it), url: streamUrl('live', it), streamId: String(it.stream_id), isLive: true, poster: it.stream_icon || '' })), i - start, label);
}
function openLiveActions(i) {
  const it = S.rendered.live[i]; if (!it) return;
  const fav = isFav('live', it);
  showSheet(itemName(it), `
    <button class="menu-item" onclick="closeTop();playLive(${i})">${icon('play')}Reproducir</button>
    <button class="menu-item" onclick="closeTop();addLiveToList(${i})">${icon('list')}Añadir a Mi lista</button>
    <button class="menu-item" onclick="closeTop();toggleFav('live',S.rendered.live[${i}]);refreshFavIcons()">${icon(fav ? 'star' : 'star-o')}${fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}</button>
    <button class="menu-item" onclick="closeTop();copyText(${jsArg(streamUrl('live', it))},'Enlace del canal copiado')">${icon('copy')}Copiar enlace</button>`);
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

/* ═══════════════════════════ PANTALLAS: PELÍCULAS Y SERIES ═══════════════════════════ */
let gridObserver = {};
function ensureGrid(type, cat) {
  const body = $(`${type}-body`);
  if (!S.session) { body.innerHTML = noAccountHtml(); return; }
  if (cat) S.cfg[`cat_${S.activeId}_${type}`] = cat;
  const want = cat || defaultCat(type);
  if (S.view[type] === want && body.querySelector('.grid')) { renderContinue(type); return; }
  loadGrid(type, want);
}
function continueItems(type, sess) {
  let list = [];
  try { if (window.NativeApp && NativeApp.getContinueWatching) list = JSON.parse(NativeApp.getContinueWatching() || '[]'); } catch { }
  const acc = sess || S.session; if (!acc) return [];
  const prefix = `${acc.host}/${type === 'vod' ? 'movie' : 'series'}/${acc.username}/`;
  return list.filter(x => x.url && x.url.startsWith(prefix) && x.dur > 0 && !(parentalLocked() && ADULT_RX.test(x.name || ''))).slice(0, 15);
}
function continueHtml(type) {
  const list = continueItems(type);
  if (!list.length) return '';
  return `<h2 class="sec">Continuar viendo</h2><div class="rail">${list.map((x, i) => {
    const left = Math.max(1, Math.round((x.dur - x.pos) / 60000));
    return `<button class="cw" onclick="resumeItem('${type}',${i})"><div class="img">${x.poster ? `<img src="${esc(x.poster)}" loading="lazy" alt="" onerror="this.remove()">` : ''}<span class="pl">${icon('play')}</span><i style="width:${Math.round(x.pos / x.dur * 100)}%"></i></div><b>${esc(x.name)}</b><small>Quedan ${left} min</small></button>`;
  }).join('')}</div>`;
}
function renderContinue(type) { const el = $(`${type}-continue`); if (el) el.innerHTML = continueHtml(type); }
function resumeItem(type, i) {
  const x = continueItems(type)[i]; if (!x) return;
  nativePlay([{ name: x.name, url: x.url, streamId: x.streamId || '', isLive: false, poster: x.poster || '' }], 0, type === 'vod' ? 'Películas' : 'Series');
}

async function loadGrid(type, cat) {
  S.view[type] = cat;
  const body = $(`${type}-body`);
  body.innerHTML = `<div id="${type}-continue">${continueHtml(type)}</div>
    <h2 class="sec">${type === 'vod' ? 'Explorar películas' : 'Explorar series'}</h2>
    <div class="chips" style="margin:0 -16px;padding-bottom:12px">${chipsHtml(type, cat)}</div>
    <div id="${type}-grid-wrap">${loadingHtml(type === 'vod' ? 'Cargando películas…' : 'Cargando series…')}</div>`;
  const on = body.querySelector('.chips .chip.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (cat === '*') { $(`${type}-grid-wrap`).innerHTML = categoryListHtml(type); return; }
  let items;
  try { items = cat === 'fav' ? Object.values(favMap(type)) : await getList(type, cat); }
  catch (e) { if (S.view[type] === cat) $(`${type}-grid-wrap`).innerHTML = errorState(type === 'vod' ? 'mov' : 'ser', e, `loadGrid('${type}',${jsArg(cat)})`); return; }
  if (S.view[type] !== cat) return;
  const wrap = $(`${type}-grid-wrap`);
  if (!items.length) {
    wrap.innerHTML = cat === 'fav' ? emptyState('star', 'Aún no tienes favoritos', 'Abre una ficha y toca la estrella para guardarla aquí.') : emptyState(type === 'vod' ? 'mov' : 'ser', 'Esta categoría está vacía', 'Elige otra categoría.');
    return;
  }
  // Más recientes primero cuando el servidor da la fecha en que se agregó.
  items = filterAllowed(type, items);
  if (items[0] && items[0].added) items = [...items].sort((a, b) => (+b.added || 0) - (+a.added || 0));
  S.rendered[type] = items;
  wrap.innerHTML = `<div class="hint" style="margin-bottom:10px">${fmtNum(items.length)} ${type === 'vod' ? 'películas' : 'series'}</div><div class="grid" id="${type}-grid"></div><div class="more-sentinel" id="${type}-more"></div>`;
  S[`${type}Shown`] = 0;
  appendGrid(type);
  if (gridObserver[type]) gridObserver[type].disconnect();
  gridObserver[type] = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) appendGrid(type); }, { root: body, rootMargin: '800px' });
  gridObserver[type].observe($(`${type}-more`));
}
function posterHtml(type, it, onclick) {
  const img = itemImg(type, it), r = rating(it), q = quality(it.name), name = cleanTitle(itemName(it));
  return `<button class="po${img ? '' : ' noimg'}" onclick="${onclick}">${img ? `<img src="${esc(img)}" loading="lazy" alt="" onerror="this.parentNode.classList.add('noimg');this.remove()">` : ''}
    ${r ? `<span class="r">★ ${r}</span>` : ''}${q ? `<span class="q">${q}</span>` : ''}<span class="t">${esc(name)}</span>${isFav(type, it) ? `<span class="fv">${icon('star')}</span>` : ''}</button>`;
}
function appendGrid(type) {
  const grid = $(`${type}-grid`); if (!grid) return;
  const items = S.rendered[type], from = S[`${type}Shown`], to = Math.min(items.length, from + CHUNK_GRID);
  if (from >= to) return;
  let html = '';
  for (let i = from; i < to; i++) html += posterHtml(type, items[i], `openDetail('${type}',S.rendered.${type}[${i}])`);
  grid.insertAdjacentHTML('beforeend', html);
  S[`${type}Shown`] = to;
}

/* ═══════════════════════════ FICHA ═══════════════════════════ */
async function openDetail(type, it, accId) {
  if (!it) return;
  accId = accId || S.activeId;
  const sess = sessionFor(accId);
  S.detail = { type, item: it, info: null, season: null, accId, sess };
  const page = $('page-detail');
  page.innerHTML = detailShell(type, it, null);
  page.scrollTop = 0;
  showPage('page-detail');
  try {
    const info = type === 'vod'
      ? await apiGet(`${sess.apiUrl}&action=get_vod_info&vod_id=${encodeURIComponent(it.stream_id)}`, 25000, { noBrake: accId !== S.activeId })
      : await apiGet(`${sess.apiUrl}&action=get_series_info&series_id=${encodeURIComponent(it.series_id)}`, 25000, { noBrake: accId !== S.activeId });
    if (!S.detail || S.detail.item !== it) return;
    S.detail.info = info || {};
    page.innerHTML = detailShell(type, it, S.detail.info);
  } catch (e) {
    if (!S.detail || S.detail.item !== it) return;
    const syn = page.querySelector('.syn'); if (syn) syn.textContent = `No se pudo cargar la información: ${e.message}`;
  }
}
function detailShell(type, it, info) {
  const inf = (info && info.info) || {};
  const name = cleanTitle(inf.name || itemName(it));
  const poster = inf.cover_big || inf.movie_image || inf.cover || itemImg(type, it);
  const back = (Array.isArray(inf.backdrop_path) ? inf.backdrop_path[0] : inf.backdrop_path) || poster;
  const r = rating({ rating: inf.rating || it.rating, rating_5based: it.rating_5based });
  const year = (inf.releasedate || inf.releaseDate || inf.release_date || it.year || '').toString().slice(0, 4);
  const dur = inf.duration || (inf.episode_run_time ? `${inf.episode_run_time} min por episodio` : '');
  const q = quality(itemName(it));
  const genres = String(inf.genre || '').split(/[,/]/).map(s => s.trim()).filter(Boolean);
  const fav = isFav(type, it, S.detail.accId);
  const loading = !info, sess = S.detail.sess, srcAcc = accountById(S.detail.accId);
  let audio = '';
  if (info && info.movie_data && inf.audio && inf.audio.tags && inf.audio.tags.language) audio = inf.audio.tags.language;
  const seasons = type === 'series' && info ? Object.keys(info.episodes || {}).sort((a, b) => +a - +b) : [];
  if (type === 'series' && info && seasons.length && !S.detail.season) S.detail.season = seasons[0];
  const cast = String(inf.cast || inf.actors || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
  return `
    <div class="hero">${back ? `<img class="bg" src="${esc(back)}" alt="" onerror="this.remove()">` : ''}
      <div class="top"><button class="ib" onclick="closeTop()" aria-label="Volver">${icon('back')}</button>
      <button class="ib" id="detail-fav" style="${fav ? 'color:var(--warn)' : ''}" onclick="toggleDetailFav()" aria-label="Favorito">${icon(fav ? 'star' : 'star-o')}</button></div>
    </div>
    <div class="head">
      <div class="poster">${poster ? `<img src="${esc(poster)}" alt="" onerror="this.remove()">` : ''}</div>
      <div class="ttl"><h2>${esc(name)}</h2>
        ${srcAcc && S.accounts.length > 1 ? `<div class="hint" style="margin-top:4px">${icon('tv', 'tiny')} ${esc(serverName(srcAcc))} · ${esc(srcAcc.username)}</div>` : ''}
        <div class="pills">${r ? `<span class="s">★ ${r}</span>` : ''}${year ? `<span>${esc(year)}</span>` : ''}${dur ? `<span>${esc(dur)}</span>` : ''}${q ? `<span>${q}</span>` : ''}${type === 'series' && seasons.length ? `<span>${seasons.length} ${seasons.length === 1 ? 'temporada' : 'temporadas'}</span>` : ''}</div>
      </div>
    </div>
    <div class="body">
      ${genres.length || audio ? `<div class="pills" style="margin-top:14px">${genres.map(g => `<span>${esc(g)}</span>`).join('')}${audio ? `<span>Audio: ${esc(audio)}</span>` : ''}</div>` : ''}
      <div class="cta">
        ${type === 'vod'
          ? `<button class="btn primary" onclick="playVod()">${icon('play')}Reproducir</button>
             <button class="sq" onclick="addDetailToList()" aria-label="Añadir a Mi lista">${icon('plus')}</button>
             <button class="sq" onclick="copyText(${jsArg(streamUrl('vod', it, sess))},'Enlace copiado')" aria-label="Copiar enlace">${icon('copy')}</button>`
          : `<button class="btn primary" ${loading || !seasons.length ? 'disabled' : ''} onclick="playEpisode(${jsArg(S.detail?.season || '')},0)">${icon('play')}${seasons.length ? `Ver T${esc(S.detail?.season)} E1` : 'Reproducir'}</button>
             <button class="sq" ${loading ? 'disabled' : ''} onclick="openSeriesAddMenu()" aria-label="Añadir a Mi lista">${icon('plus')}</button>`}
      </div>
      <p class="syn">${loading ? '<span class="spinner"></span>' : esc(inf.plot || inf.description || 'Sin sinopsis disponible.')}</p>
      ${inf.director ? `<div class="facts"><b>Dirección:</b> ${esc(inf.director)}</div>` : ''}
      ${cast.length ? `<h2 class="sec">Reparto</h2><div class="cast">${cast.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
      ${type === 'series' && info ? seriesEpisodesHtml(info) : ''}
    </div>`;
}
function seriesEpisodesHtml(info) {
  const eps = info.episodes || {}, seasons = Object.keys(eps).sort((a, b) => +a - +b);
  if (!seasons.length) return `<h2 class="sec">Episodios</h2><div class="hint">El servidor no tiene episodios para esta serie.</div>`;
  const cur = S.detail.season || seasons[0], list = eps[cur] || [];
  const resume = {}; continueItems('series', S.detail.sess).forEach(x => { resume[x.url] = x; });
  return `<h2 class="sec">Episodios <button onclick="addSeason(${jsArg(cur)})">Añadir temporada</button></h2>
    <div class="seasons">${seasons.map(s => `<button class="chip${s === cur ? ' on' : ''}" onclick="selectSeason(${jsArg(s)})">Temporada ${esc(s)}</button>`).join('')}</div>
    ${list.map((ep, i) => {
      const img = ep.info && (ep.info.movie_image || ep.info.cover_big);
      const url = streamUrl('episode', ep, S.detail.sess), rs = resume[url];
      const dur = ep.info && (ep.info.duration || (ep.info.duration_secs ? Math.round(ep.info.duration_secs / 60) + ' min' : ''));
      return `<div class="ep" role="button" onclick="playEpisode(${jsArg(cur)},${i})">
        <div class="th">${img ? `<img src="${esc(img)}" loading="lazy" alt="" onerror="this.remove()">` : ''}<span class="pl">${icon('play')}</span>${rs ? `<i style="width:${Math.round(rs.pos / rs.dur * 100)}%"></i>` : ''}</div>
        <div class="n"><b>${esc(ep.episode_num || i + 1)}. ${esc(ep.title || `Episodio ${i + 1}`)}</b><small>${esc(dur || '')}</small></div>
        <button class="add" onclick="event.stopPropagation();addEpisode(${jsArg(cur)},${i})" aria-label="Añadir episodio a Mi lista">${icon('plus')}</button>
      </div>`;
    }).join('')}`;
}
function selectSeason(s) { if (!S.detail) return; S.detail.season = s; const top = $('page-detail').scrollTop; $('page-detail').innerHTML = detailShell(S.detail.type, S.detail.item, S.detail.info); $('page-detail').scrollTop = top; }
function toggleDetailFav() {
  if (!S.detail) return;
  const on = toggleFav(S.detail.type, S.detail.item, null, S.detail.accId);
  const b = $('detail-fav'); b.innerHTML = icon(on ? 'star' : 'star-o'); b.style.color = on ? 'var(--warn)' : '';
  const g = $(`${S.detail.type}-grid`); if (g && S.view[S.detail.type] === 'fav') loadGrid(S.detail.type, 'fav');
}
function detailMeta() {
  const { item, info } = S.detail; const inf = (info && info.info) || {};
  return { synopsis: inf.plot || inf.description || '', thumbnail: inf.cover_big || inf.movie_image || itemImg(S.detail.type, item) || '' };
}
function playVod() {
  const { item } = S.detail; const m = detailMeta();
  // Lista = la categoría visible, para pasar a la siguiente película desde el reproductor.
  const list = S.detail.accId === S.activeId && S.rendered.vod.includes(item) ? S.rendered.vod : [item], sess = S.detail.sess;
  let idx = list.indexOf(item), start = 0, slice = list;
  if (list.length > 300) { start = Math.max(0, idx - 150); slice = list.slice(start, start + 300); }
  nativePlay(slice.map(it => ({ name: cleanTitle(itemName(it)), url: streamUrl('vod', it, sess), streamId: String(it.stream_id), isLive: false, poster: it === item ? m.thumbnail : (it.stream_icon || '') })), idx - start, 'Películas', sess.apiUrl);
}
function addDetailToList() {
  const { item } = S.detail; const m = detailMeta();
  const own = S.detail.accId === S.activeId;
  addToList({ name: cleanTitle(itemName(item)), url: streamUrl('vod', item, S.detail.sess), category: (own && catsOf('vod').find(c => String(c.category_id) === String(item.category_id))?.category_name) || 'Películas', ...m });
}
function epName(snum, i, ep) { return `${cleanTitle(itemName(S.detail.item))} T${snum}E${ep.episode_num || i + 1}${ep.title ? ' - ' + ep.title : ''}`; }
function playEpisode(snum, i) {
  if (!S.detail || !S.detail.info) return;
  const eps = (S.detail.info.episodes || {})[snum] || []; if (!eps[i]) return;
  const m = detailMeta();
  nativePlay(eps.map((ep, k) => ({ name: epName(snum, k, ep), url: streamUrl('episode', ep, S.detail.sess), streamId: String(ep.id), isLive: false, poster: (ep.info && ep.info.movie_image) || m.thumbnail })), i, 'Series', S.detail.sess.apiUrl);
}
function addEpisode(snum, i) {
  const ep = ((S.detail.info.episodes || {})[snum] || [])[i]; if (!ep) return;
  addToList({ name: epName(snum, i, ep), url: streamUrl('episode', ep, S.detail.sess), category: 'Series', ...detailMeta() });
}
function addSeason(snum) {
  const eps = (S.detail.info.episodes || {})[snum] || [], m = detailMeta();
  eps.forEach((ep, i) => addToList({ name: epName(snum, i, ep), url: streamUrl('episode', ep, S.detail.sess), category: 'Series', ...m }, true));
  renderMyList(); toast(`Temporada ${snum} añadida (${eps.length} episodios)`, 'ok');
}
function addWholeSeries() {
  const { item } = S.detail;
  addToList({ name: cleanTitle(itemName(item)), url: streamUrl('series', item, S.detail.sess), category: 'Series', ...detailMeta() });
}
function openSeriesAddMenu() {
  if (!S.detail || !S.detail.info) return;
  const s = S.detail.season;
  showSheet('Añadir a Mi lista', `
    ${s ? `<button class="menu-item" onclick="closeTop();addSeason(${jsArg(s)})">${icon('list')}Temporada ${esc(s)} completa</button>` : ''}
    <button class="menu-item" onclick="closeTop();addWholeSeries()">${icon('ser')}Serie completa (un solo enlace)</button>`);
}

/* ═══════════════════════════ REPRODUCTOR NATIVO ═══════════════════════════ */
function nativePlay(items, startIndex, category, apiUrl) {
  const payload = { apiUrl: apiUrl || (S.session ? S.session.apiUrl : ''), items, startIndex, category };
  if (window.NativePlayer && NativePlayer.play) NativePlayer.play(JSON.stringify(payload));
  else toast('El reproductor solo funciona en la app instalada', 'err');
}
window.onNativeAddToList = function (name, url, category) { addToList({ name, url, category, synopsis: '', thumbnail: '' }); };

/* ═══════════════════════════ BÚSQUEDA UNIVERSAL ═══════════════════════════ */
// Busca en todas las cuentas activas a la vez y agrupa por título, indicando en qué servidor está cada uno.
let searchType = 'all';
S.searchScope = 'all';
S.accLists = {};
function accLabel(a) { return `${a.username} · ${hostLabel(a.host)}`; }
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
  if (cached && Date.now() - cached.ts < TTL_STREAMS && Array.isArray(cached.items)) return (S.accLists[key] = cached.items);
  const data = await apiGet(`${apiUrlOf(acc)}&action=${TYPES[type].streams}`, 90000, { noBrake: true });
  const items = Array.isArray(data) ? data : [];
  S.accLists[key] = items; idb.set(dbKey, { ts: Date.now(), items });
  return items;
}
function openSearch() {
  if (!S.accounts.length) { toast('Primero agrega una cuenta', 'err'); switchTab('accounts'); return; }
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
      const cell = (it, i) => t === 'live'
        ? `<button class="ch${i >= lim ? ' more' : ''}" onclick="openSearchItem(${ai},'live',${i})">${logoHtml(itemName(it), it.stream_icon)}<span class="n"><b>${esc(itemName(it))}</b></span>${icon('play')}</button>`
        : posterHtml(t, it, `openSearchItem(${ai},'${t}',${i})`).replace('<button class="po', `<button class="po${i >= lim ? ' more' : ''}`);
      html += `<div class="${t === 'live' ? 'res-list' : 'grid'}">${r.map(cell).join('')}</div>`;
      if (r.length > lim) html += `<button class="btn sm more-btn" onclick="showMoreResults(this)">Ver ${fmtNum(r.length - lim)} más</button>`;
      if (f[t].length > MAXR) html += `<div class="hint" style="margin-top:6px">Se muestran los primeros ${MAXR}. Escribe una palabra más precisa para ver el resto.</div>`;
    }
    html += `</details>`;
  });
  body.innerHTML = html;
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
    nativePlay([{ name: itemName(it), url: streamUrl('live', it, sess), streamId: String(it.stream_id), isLive: true, poster: it.stream_icon || '' }], 0, `Búsqueda · ${serverName(accountById(h.accId) || {})}`, sess.apiUrl);
    return;
  }
  openDetail(type, h.item, h.accId);
}

/* ═══════════════════════════ MI LISTA ═══════════════════════════ */
function addToList(entry, silent) {
  if (S.myList.some(x => x.url === entry.url)) { if (!silent) toast('Ya está en Mi lista'); return; }
  S.myList.push(entry);
  S.thumbnails.push({ name: entry.name, url: entry.thumbnail || '', description: `*${entry.name}*\n${entry.category}\n${entry.synopsis || ''}` });
  saveMyList(); updateListBadge();
  if (!silent) { toast(`Añadido a Mi lista: ${entry.name}`, 'ok'); if (S.tab === 'mylist') renderMyList(); }
}
function updateListBadge() { $('nav-list-count').textContent = `(${S.myList.length})`; }
function renderMyList() {
  const el = $('mylist-body');
  if (!S.myList.length) {
    el.innerHTML = emptyState('list', 'Tu lista está vacía', 'Añade canales, películas o episodios con el botón + y luego descárgala como M3U o envíala por Telegram.');
    return;
  }
  const groups = {};
  S.myList.forEach((it, i) => { (groups[it.category || 'Otros'] = groups[it.category || 'Otros'] || []).push(i); });
  el.innerHTML = `<div class="list-actions" style="margin-top:4px">
      <button class="btn sm primary" onclick="downloadM3U()">${icon('save')}Descargar M3U</button>
      <button class="btn sm" onclick="sendListToTelegram()">${icon('send')}Telegram</button>
      <button class="btn sm danger" onclick="clearList()">${icon('trash')}Vaciar</button>
    </div>
    <div class="hint" style="margin-top:8px">${S.myList.length} ${S.myList.length === 1 ? 'elemento' : 'elementos'}. Toca uno para reproducirlo.</div>
    ${Object.entries(groups).map(([g, idxs]) => `<div class="group-h"><span>${esc(g)}</span><span>${idxs.length}</span></div>` + idxs.map(i => {
      const it = S.myList[i];
      return `<div class="li"><span class="th">${it.thumbnail ? `<img src="${esc(it.thumbnail)}" loading="lazy" alt="" onerror="this.remove()">` : icon(it.url.includes('/live/') ? 'live' : 'mov')}</span>
        <button class="n" onclick="playFromList(${i})"><b>${esc(it.name)}</b><small>${esc(hostLabel(it.url.split('/').slice(0, 3).join('/')))}</small></button>
        <button class="x" onclick="removeFromList(${i})" aria-label="Quitar">${icon('close')}</button></div>`;
    }).join('')).join('')}`;
}
function playFromList(i) {
  nativePlay(S.myList.map(it => ({ name: it.name, url: it.url, streamId: '', isLive: it.url.includes('/live/'), poster: it.thumbnail || '' })), i, 'Mi lista');
}
function removeFromList(idx) { S.myList.splice(idx, 1); S.thumbnails.splice(idx, 1); saveMyList(); updateListBadge(); renderMyList(); }
function clearList() {
  if (!S.myList.length) return; if (!confirm('¿Vaciar toda la lista?')) return;
  S.myList = []; S.thumbnails = []; saveMyList(); updateListBadge(); renderMyList(); toast('Lista vaciada');
}
function buildM3U() {
  let c = '#EXTM3U\n';
  S.myList.forEach(item => {
    const logo = item.thumbnail ? ` tvg-logo="${String(item.thumbnail).replace(/"/g, '')}"` : '';
    c += `#EXTINF:-1${logo} group-title="${String(item.category || '').replace(/"/g, "'")}",${item.name}\n${item.url}\n`;
  });
  return c;
}
function downloadM3U() {
  if (!S.myList.length) { toast('La lista está vacía', 'err'); return; }
  const c = buildM3U(), fname = `ListaJOX3_${new Date().toISOString().slice(0, 10)}.m3u`;
  if (window.NativeFiles && NativeFiles.saveTextFile) { NativeFiles.saveTextFile(c, fname); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c], { type: 'audio/x-mpegurl' })); a.download = fname; a.click();
  toast('Lista descargada', 'ok');
}

/* ═══════════════════════════ TELEGRAM ═══════════════════════════ */
function getTg() { return { token: S.cfg.token || '', chatId: S.cfg.chatId || '' }; }
async function tgSendText(token, chatId, text) {
  const MAX = 4096;
  for (let i = 0; i < text.length; i += MAX) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + MAX) }) });
    if (!res.ok) { let e = {}; try { e = await res.json(); } catch { } throw new Error(e.description || 'Telegram rechazó el mensaje'); }
  }
}
async function tgSendPhoto(token, chatId, photoUrl, caption) {
  await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: caption.slice(0, 1024) }) });
}
async function tgSendDoc(token, chatId, content, filename) {
  const fd = new FormData(); fd.append('chat_id', chatId); fd.append('document', new Blob([content], { type: 'text/plain' }), filename);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: fd });
  if (!res.ok) { let e = {}; try { e = await res.json(); } catch { } throw new Error(e.description || 'Telegram rechazó el archivo'); }
}
function needTg() {
  const { token, chatId } = getTg();
  if (!token || !chatId) { toast('Configura Telegram en Ajustes primero', 'err'); openSettings(); return null; }
  return { token, chatId };
}
async function sendToTelegram() {
  if (!S.session) { toast('Primero agrega una cuenta', 'err'); return; }
  const tg = needTg(); if (!tg) return;
  const acc = activeAccount(), { host, username, password, m3uLink, epgLink, ipLink, categories: cats } = S.session, geo = acc.geo || {};
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : 'Ilimitado';
  const remDays = daysLeft(acc), flag = flagEmoji(geo.countryCode || '');
  const catNames = arr => (arr && arr.length) ? arr.map(c => c.category_name || 'Sin nombre').join(', ') : 'N/A';
  const part1 = `🎉 === Resultado M3U por JOX3 === 🎉\n\n` +
    `🌐 Host: ${host}\n👤 Usuario: ${username}\n🔑 Contraseña: ${password}\n🟢 Estado: ${acc.status}\n` +
    `🔗 Conexiones: ${acc.activeCons || 0}/${acc.maxCons || 0}\n📅 Creado: ${fmt(tsDate(acc.createdAt))}\n🗓️ Vencimiento: ${fmt(tsDate(acc.expDate))}\n` +
    `⌛ Días restantes: ${remDays !== null ? remDays : 'N/A'} ${semaforo(remDays)}\n🕒 Timezone: ${geo.timezone || 'N/A'} ${flag}\n` +
    `📍 Ubicación: ${flag} ${[geo.city, geo.country].filter(Boolean).join(', ') || 'N/A'}\n🏢 ISP: ${geo.isp || 'N/A'}\n` +
    `🧪 Prueba: ${acc.isTrial ? 'Sí' : 'No'}\n🎞️ Formatos: ${(acc.formats || []).join(', ') || 'N/A'}\n` +
    `📺 Enlace M3U: ${m3uLink}\n📜 Enlace EPG: ${epgLink}\n📌 M3U por IP: ${ipLink || 'N/A'}\n`;
  const chunks = [`\n📡 TV en vivo (${cats.live.length}): ${catNames(cats.live)}`, `\n🎬 Series (${cats.series.length}): ${catNames(cats.series)}`,
    `\n🎥 Películas (${cats.vod.length}): ${catNames(cats.vod)}`, `\n\n📅 Escaneado: ${fmt(new Date())}`];
  const MAX = 4096, parts = []; let cur = part1;
  for (const ch of chunks) {
    if ((cur + ch).length <= MAX) cur += ch;
    else { parts.push(cur); if (ch.length > MAX) { (ch.match(/.{1,4000}(,|$)/gs) || [ch]).forEach(l => parts.push(l.trim())); cur = ''; } else cur = ch; }
  }
  if (cur.trim()) parts.push(cur);
  try {
    toast('Enviando a Telegram…');
    for (const m of parts) if (m.trim()) await tgSendText(tg.token, tg.chatId, m);
    toast(`Enviado a Telegram (${parts.length} ${parts.length > 1 ? 'mensajes' : 'mensaje'})`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
async function sendListToTelegram() {
  if (!S.myList.length) { toast('La lista está vacía', 'err'); return; }
  const tg = needTg(); if (!tg) return;
  try {
    toast('Enviando lista…');
    await tgSendDoc(tg.token, tg.chatId, buildM3U(), `ListaJOX3_${new Date().toISOString().slice(0, 10)}.m3u`);
    toast('Lista enviada', 'ok');
    let sent = 0;
    for (const th of S.thumbnails) if (th.url) { await tgSendPhoto(tg.token, tg.chatId, th.url, th.description); sent++; }
    if (sent) toast(`${sent} miniaturas enviadas`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ═══════════════════════════ AJUSTES ═══════════════════════════ */
function openSettings() {
  const st = S.cfg.startTab || 'accounts';
  const opt = (v, l) => `<option value="${v}"${st === v ? ' selected' : ''}>${l}</option>`;
  $('settings-body').innerHTML = `
    <div class="set-title">General</div>
    <div class="set-group">
      <div class="set-row"><span class="n"><b>Pantalla de inicio</b><small>La que se abre al entrar a la app</small></span>
        <select onchange="S.cfg.startTab=this.value;saveCfg();toast('Guardado','ok')">${opt('accounts', 'Cuentas')}${opt('live', 'En vivo')}${opt('vod', 'Películas')}${opt('series', 'Series')}${opt('mylist', 'Mi lista')}${opt('last', 'La última que usé')}</select></div>
      <button class="set-row" onclick="S.cfg.autoCheck=!S.cfg.autoCheck;saveCfg();openSettings()"><span class="n"><b>Verificar canales automáticamente</b><small>Al abrir una categoría. Algunos servidores bloquean la IP si se verifican muchos canales; si pasa, déjalo apagado y usa el botón Verificar canales.</small></span><span class="switch${S.cfg.autoCheck ? ' on' : ''}"></span></button>
      <button class="set-row" onclick="S.cfg.showEpg=S.cfg.showEpg===false;saveCfg();openSettings()"><span class="n"><b>Mostrar la guía en la lista</b><small>Lo que están pasando en cada canal</small></span><span class="switch${S.cfg.showEpg !== false ? ' on' : ''}"></span></button>
      <button class="set-row" onclick="toggleOnlineOnly();openSettings()"><span class="n"><b>Ocultar canales caídos</b><small>En la pestaña En vivo, tras verificarlos</small></span><span class="switch${S.onlineOnly ? ' on' : ''}"></span></button>
    </div>
    <div class="set-title">Tema</div>
    <div class="set-group"><div class="skins">${SKINS.map(s => `<button class="skin${(S.cfg.skin || 'default') === s.id ? ' on' : ''}" style="--c:${s.c}" onclick="setSkin('${s.id}');openSettings()" aria-label="${s.name}" title="${s.name}"></button>`).join('')}</div></div>
    <div class="set-title">Telegram</div>
    <div class="set-group" style="padding:14px">
      <div class="field"><label for="tg-token">Token del bot</label><input class="input" type="password" id="tg-token" value="${esc(S.cfg.token || '')}" placeholder="123456:ABC…" autocomplete="off"></div>
      <div class="field"><label for="tg-chatid">Chat ID</label><input class="input" id="tg-chatid" value="${esc(S.cfg.chatId || '')}" placeholder="942555986" inputmode="numeric"></div>
      <div class="list-actions"><button class="btn sm primary" onclick="saveTgConfig()">Guardar</button><button class="btn sm" onclick="testTelegram()">Enviar prueba</button></div>
      <div id="tg-status"></div>
    </div>
    <div class="set-title">Control parental</div>
    <div class="set-group">
      ${!parentalOn()
        ? `<button class="set-row" onclick="setupParental()"><span class="n"><b>Activar control parental</b><small>Oculta con un PIN el contenido para adultos y las categorías que elijas</small></span>${icon('lock')}</button>`
        : `<button class="set-row" onclick="${parentalLocked() ? 'askUnlock()' : 'lockNow()'}"><span class="n"><b>${parentalLocked() ? 'Bloqueado' : 'Desbloqueado temporalmente'}</b><small>${parentalLocked() ? 'Toca para desbloquear con el PIN' : 'Se vuelve a bloquear solo en 1 hora o al cerrar la app. Toca para bloquear ya.'}</small></span>${icon(parentalLocked() ? 'lock' : 'lock-open')}</button>
           <button class="set-row" onclick="toggleAutoAdult()"><span class="n"><b>Ocultar contenido para adultos</b><small>Detecta por nombre: adultos, XXX, +18, eróticos…</small></span><span class="switch${pc().auto !== false ? ' on' : ''}"></span></button>
           <button class="set-row" onclick="openBlockedCats()"><span class="n"><b>Elegir categorías bloqueadas</b><small>De la cuenta activa: TV, películas y series</small></span>${icon('chev')}</button>
           <button class="set-row" onclick="changePin()"><span class="n"><b>Cambiar PIN</b></span>${icon('chev')}</button>
           <button class="set-row" onclick="disableParental()"><span class="n"><b style="color:var(--off)">Desactivar control parental</b></span></button>`}
    </div>
    <div class="set-title">Vencimientos</div>
    <div class="set-group">
      <button class="set-row" onclick="S.cfg.alerts=S.cfg.alerts===false;saveCfg();pushExpiryWatch();openSettings()"><span class="n"><b>Avisarme antes de que venza una cuenta</b><small>Notificación del teléfono, aunque la app esté cerrada</small></span><span class="switch${S.cfg.alerts !== false ? ' on' : ''}"></span></button>
      <div class="set-row"><span class="n"><b>Con cuántos días de anticipación</b><small>También marca en amarillo las que están por vencer</small></span>
        <select onchange="S.cfg.alertDays=+this.value;saveCfg();pushExpiryWatch();toast('Guardado','ok')">${[1, 3, 5, 7, 10, 15].map(d => `<option value="${d}"${alertDays() === d ? ' selected' : ''}>${d} ${d === 1 ? 'día' : 'días'}</option>`).join('')}</select></div>
    </div>
    <div class="set-title">Actualizaciones</div>
    <div class="set-group">
      <button class="set-row" onclick="checkUpdate(true)"><span class="n"><b>Buscar actualizaciones</b><small>Versión instalada: ${esc(appVersion())}</small></span>${icon('refresh')}</button>
      <button class="set-row" onclick="S.cfg.autoUpdate=S.cfg.autoUpdate===false;saveCfg();openSettings()"><span class="n"><b>Avisarme de versiones nuevas</b><small>Revisa GitHub al abrir la app</small></span><span class="switch${S.cfg.autoUpdate !== false ? ' on' : ''}"></span></button>
    </div>
    <div class="set-title">Datos</div>
    <div class="set-group">
      <button class="set-row" onclick="clearCache()"><span class="n"><b>Borrar catálogos guardados</b><small>Se vuelven a descargar la próxima vez</small></span>${icon('refresh')}</button>
    </div>
    <div class="hint" style="text-align:center;margin-top:8px">JOX3 Verifier ${esc(appVersion())}</div>`;
  showPage('page-settings');
}
function setSkin(skin) {
  document.body.className = skin === 'default' ? '' : `skin-${skin}`;
  S.cfg.skin = skin; saveCfg();
}
function saveTgConfig() {
  S.cfg.token = $('tg-token').value.trim(); S.cfg.chatId = $('tg-chatid').value.trim(); saveCfg(); toast('Telegram guardado', 'ok');
}
async function testTelegram() {
  saveTgConfig();
  const { token, chatId } = getTg(), st = $('tg-status');
  if (!token || !chatId) { toast('Completa el token y el chat ID', 'err'); return; }
  st.innerHTML = `<div class="tg-status"><span class="spinner"></span>Enviando prueba…</div>`;
  try { await tgSendText(token, chatId, '🌟 JOX3 Verifier — conexión con Telegram correcta ✅'); st.innerHTML = `<div class="tg-status" style="color:var(--on)">${icon('check')}Mensaje de prueba enviado</div>`; }
  catch (e) { st.innerHTML = `<div class="tg-status" style="color:var(--off)">${icon('close')}${esc(e.message)}</div>`; }
}
async function clearCache() {
  await idb.clear(); S.lists = {}; S.accLists = {}; S.view = { live: null, vod: null, series: null };
  toast('Catálogos borrados', 'ok');
}

/* ═══════════════════════════ ALERTAS DE VENCIMIENTO ═══════════════════════════ */
// El aviso lo da Android aunque la app esté cerrada; aquí solo se le pasan las fechas.
function pushExpiryWatch() {
  if (!(window.NativeApp && NativeApp.setExpiryWatch)) return;
  const list = S.accounts.filter(a => a.status === 'Active' && tsDate(a.expDate)).map(a => ({ id: a.id, name: a.username, server: hostLabel(a.host), exp: +a.expDate }));
  try { NativeApp.setExpiryWatch(JSON.stringify(list), S.cfg.alerts === false ? 0 : alertDays()); } catch { }
  if (S.cfg.alerts !== false && list.length && !S.cfg.notifAsked && NativeApp.requestNotifications) {
    S.cfg.notifAsked = true; saveCfg();
    try { NativeApp.requestNotifications(); } catch { }
  }
}

/* ═══════════════════════════ ACTUALIZACIONES ═══════════════════════════ */
const REPO = 'JOX36/jox3-m3u-verifier';
function buildNum(v) { const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/); return m ? +m[3] : 0; }
async function checkUpdate(manual) {
  if (manual) toast('Buscando actualizaciones…');
  try {
    const rel = await apiGet(`https://api.github.com/repos/${REPO}/releases/latest`, 15000, { noBrake: true });
    const ver = String(rel.tag_name || '').replace(/^v/i, '');
    const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name));
    S.cfg.lastUpdateCheck = Date.now(); saveCfg();
    if (!apk || buildNum(ver) <= buildNum(appVersion())) { if (manual) toast(`Tienes la última versión (${appVersion()})`, 'ok'); return; }
    if (!manual && S.cfg.skipVersion === ver) return;
    S.update = { ver, url: apk.browser_download_url, notes: rel.body || '', size: apk.size };
    showUpdateWhenFree(manual);
  } catch (e) {
    if (manual) toast(e.status === 404 ? 'Aún no hay versiones publicadas' : `No se pudo revisar: ${e.message}`, 'err');
  }
}
// El aviso no debe tapar lo que el usuario está haciendo: espera a que no haya nada abierto.
function showUpdateWhenFree(now) {
  if (now || !S.stack.length) { showUpdateSheet(); return; }
  setTimeout(() => showUpdateWhenFree(false), 20000);
}
function showUpdateSheet() {
  const u = S.update; if (!u) return;
  const notes = u.notes.replace(/\r/g, '').split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(l => l && !/^#|generated with|claude\.ai|^merge pull request|co-authored-by|claude-session/i.test(l)).slice(0, 8);
  showSheet(`Versión ${u.ver} disponible`, `
    <div class="hint" style="margin:-4px 0 10px">Tienes la ${esc(appVersion())}${u.size ? ` · descarga de ${(u.size / 1048576).toFixed(1)} MB` : ''}. Se instala encima, sin perder tus cuentas ni tu lista.</div>
    ${notes.length ? `<ul class="notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div id="upd-progress" hidden><div class="upd-bar"><i id="upd-bar" style="width:0"></i></div><div class="hint" id="upd-txt">Descargando…</div></div>
    <div class="list-actions" style="margin-top:14px" id="upd-actions">
      <button class="btn primary" onclick="startUpdate()">${icon('save')}Actualizar ahora</button>
      <button class="btn" onclick="S.cfg.skipVersion=${jsArg(u.ver)};saveCfg();closeTop()">Más tarde</button>
    </div>`);
}
function startUpdate() {
  const u = S.update; if (!u) return;
  if (!(window.NativeApp && NativeApp.downloadUpdate)) { window.open(u.url, '_blank'); return; }
  $('upd-progress').hidden = false; $('upd-actions').hidden = true;
  NativeApp.downloadUpdate(u.url, u.ver);
}
window.onUpdateProgress = function (pct) {
  const bar = $('upd-bar'), txt = $('upd-txt'); if (!bar) return;
  if (pct >= 0) { bar.style.width = pct + '%'; txt.textContent = pct >= 100 ? 'Abriendo el instalador…' : `Descargando… ${pct}%`; }
};
window.onUpdateError = function (msg) {
  toast(`No se pudo descargar la actualización: ${msg}`, 'err');
  if ($('upd-actions')) { $('upd-actions').hidden = false; $('upd-progress').hidden = true; }
};

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
  const first = S.accounts.length ? startTab() : 'accounts';
  S.tab = first;
  if (activeId) activateAccount(activeId).then(() => switchTab(first)); else switchTab('accounts');
  setTimeout(pushExpiryWatch, 2500);
  // Revisar si hay versión nueva (como mucho cada 12 horas).
  if (S.cfg.autoUpdate !== false && Date.now() - (S.cfg.lastUpdateCheck || 0) > 12 * 3600e3) setTimeout(() => checkUpdate(false), 4000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.tab === 'vod' || S.tab === 'series') renderContinue(S.tab);
  if (S.tab === 'accounts') checkClipboardHint();
});
init();
