'use strict';
/* ════════════════════════════════════════════════════════════════
   JOX3 Verifier — lógica de la interfaz
   Puentes nativos (Kotlin): NativeChecker, NativePlayer, NativeFiles, NativeApp
   ════════════════════════════════════════════════════════════════ */

const VERSION = '3.0';
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
  if (d < 10) return 'off';
  if (d < 20) return 'warn';
  return 'on';
}
function accDaysLabel(acc, short) {
  if (!acc.status) return short ? '—' : 'Sin verificar';
  if (acc.status !== 'Active') return acc.status === 'Expired' ? 'Vencida' : acc.status;
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
async function apiGet(url, timeoutMs = 25000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
    if (!res.ok) throw new Error(`El servidor respondió HTTP ${res.status}`);
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
  if (i >= 0) S.accounts[i] = { ...S.accounts[i], ...acc }; else S.accounts.unshift(acc);
  saveAccounts();
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
  const el = $(id); el.classList.add('show');
  if (!S.stack.some(l => l.id === id)) pushLayer('page', id);
}
function closeTop() {
  const top = S.stack.pop(); if (!top) return false;
  if (top.kind === 'sheet') { $('sheet').classList.remove('show'); $('scrim').classList.remove('show'); }
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
    el.innerHTML = emptyState('tv', 'Agrega tu primera cuenta', 'Pega un enlace M3U o los datos de tu cuenta Xtream para verificarla y ver su contenido.',
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
  const others = S.accounts.filter(a => a.id !== S.activeId);
  if (others.length) {
    html += `<h2 class="sec">Otras cuentas <span class="hint">${others.length}</span></h2>`;
    html += others.map(a => `<button class="row" onclick="openAccountActions(${jsArg(a.id)})">
        <span class="dot ${accLevel(a)}"></span>
        <span class="n"><b>${esc(a.username)}</b><small>${esc(hostLabel(a.host))}${a.geo?.countryCode ? ' · ' + flagEmoji(a.geo.countryCode) : ''}</small></span>
        <span class="end" style="color:var(--${accLevel(a) === 'muted' ? 'muted' : accLevel(a)})">${esc(accDaysLabel(a, true))}</span>
      </button>`).join('');
  }
  html += `<button class="add-card" onclick="openAddAccount()"><span class="ic">${icon('paste')}</span><span><b>Agregar cuenta</b><small id="clip-hint">Pega un enlace M3U o ingresa los datos</small></span></button>`;
  el.innerHTML = html;
  checkClipboardHint();
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
    <div class="seg" id="add-mode"><button class="on" onclick="setAddMode('url')">Enlace M3U</button><button onclick="setAddMode('manual')">Datos de la cuenta</button></div>
    <div id="add-url">
      <div class="field"><label for="m3u-url">Enlace M3U (get.php o /playlist/…/m3u_plus)</label>
        <textarea class="input" id="m3u-url" rows="3" placeholder="http://servidor:8080/get.php?username=…&password=…">${p ? esc(clip.trim()) : ''}</textarea></div>
      <button class="btn sm" onclick="pasteInto()" style="margin:-4px 0 14px">${icon('paste')}Pegar</button>
    </div>
    <div id="add-manual" hidden>
      <div class="field"><label for="add-host">Servidor</label><input class="input" id="add-host" placeholder="http://servidor:8080" inputmode="url" autocapitalize="off"></div>
      <div class="field"><label for="add-user">Usuario</label><input class="input" id="add-user" autocapitalize="off" autocomplete="off"></div>
      <div class="field"><label for="add-pass">Contraseña</label><input class="input" id="add-pass" autocapitalize="off" autocomplete="off"></div>
    </div>
    <button class="btn primary block" id="btn-verify" onclick="addAccountFromSheet()">Verificar cuenta</button>
    <div class="steps" id="verify-steps"></div>`);
}
function setAddMode(m) {
  $('add-url').hidden = m !== 'url'; $('add-manual').hidden = m !== 'manual';
  [...$('add-mode').children].forEach((b, i) => b.classList.toggle('on', (i === 0) === (m === 'url')));
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

function openAccountPage(id) {
  const a = accountById(id); if (!a) return;
  const l = linksOf(a), g = a.geo || {}, exp = tsDate(a.expDate), created = tsDate(a.createdAt);
  const cats = id === S.activeId && S.session ? S.session.categories : null;
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
      ${id === S.activeId ? `<button class="btn sm" onclick="sendToTelegram()">${icon('send')}Telegram</button>` : ''}
      <button class="btn sm danger" onclick="deleteAccount(${jsArg(id)})">${icon('trash')}Eliminar</button>
    </div>
    ${catBlock('live', 'Categorías de TV')}${catBlock('vod', 'Categorías de películas')}${catBlock('series', 'Categorías de series')}`;
  showPage('page-account');
}

/* ═══════════════════════════ CATÁLOGO ═══════════════════════════ */
function catsOf(type) { return (S.session && S.session.categories[type]) || []; }

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
function favMap(type) {
  const id = S.activeId || '_'; S.favs[id] = S.favs[id] || { live: {}, vod: {}, series: {} };
  return S.favs[id][type] = S.favs[id][type] || {};
}
function isFav(type, it) { return !!favMap(type)[itemId(type, it)]; }
function toggleFav(type, it, btn) {
  const m = favMap(type), id = itemId(type, it);
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
  return chip('fav', 'Favoritos', icon('star')) + chip('*', 'Todos') + cats.map(c => chip(c.category_id, c.category_name || 'Sin nombre')).join('');
}
function defaultCat(type) {
  const saved = S.cfg[`cat_${S.activeId}_${type}`];
  if (saved && (saved === 'fav' || saved === '*' || catsOf(type).some(c => String(c.category_id) === String(saved)))) return saved;
  if (Object.keys(favMap(type)).length) return 'fav';
  return catsOf(type)[0] ? String(catsOf(type)[0].category_id) : '*';
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
  const body = $('live-body'); body.innerHTML = loadingHtml('Cargando canales…'); $('live-bar').hidden = true;
  stopChecks();
  let items;
  try { items = cat === 'fav' ? Object.values(favMap('live')) : await getList('live', cat); }
  catch (e) { body.innerHTML = emptyState('live', 'No se pudieron cargar los canales', e.message, `<button class="btn" onclick="loadLive(${jsArg(cat)})">${icon('refresh')}Reintentar</button>`); return; }
  if (S.view.live !== cat) return;
  if (!items.length) {
    body.innerHTML = cat === 'fav' ? emptyState('star', 'Aún no tienes favoritos', 'Toca la estrella de un canal para tenerlo siempre a mano aquí.') : emptyState('live', 'Esta categoría está vacía', 'Elige otra categoría arriba.');
    return;
  }
  S.liveAll = items;
  renderLiveList();
}

function liveVisibleItems() {
  const all = S.liveAll || [];
  return S.onlineOnly ? all.filter(i => S.status[i.stream_id] !== false) : all;
}
function renderLiveList() {
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
  checkStreams(added);
  observeEpg(list);
}
function updateLiveBar() {
  const all = S.liveAll || [];
  if (!all.length) { $('live-bar').hidden = true; return; }
  let on = 0, off = 0;
  for (const it of all) { const s = S.status[it.stream_id]; if (s === true) on++; else if (s === false) off++; }
  $('live-bar').hidden = false;
  const pending = all.length - on - off;
  $('live-count').textContent = on + off ? `${on} en línea${off ? ` · ${off} caídos` : ''}${pending > 0 ? ` · ${pending} por revisar` : ''}` : `${fmtNum(all.length)} canales`;
  $('live-bar-on').style.width = `${on / all.length * 100}%`;
  $('live-bar-off').style.width = `${off / all.length * 100}%`;
  $('sw-online').classList.toggle('on', S.onlineOnly);
}
function toggleOnlineOnly() {
  S.onlineOnly = !S.onlineOnly; S.cfg.onlineOnly = S.onlineOnly; saveCfg();
  renderLiveList();
  if (S.onlineOnly) toast('Se ocultan los canales caídos');
}

/* ─── Verificación de canales (Kotlin: NativeChecker) ─── */
let checkGen = 0;
function stopChecks() {
  checkGen++;
  try { if (window.NativeChecker && NativeChecker.cancelAll) NativeChecker.cancelAll(); } catch { }
}
function checkStreams(items) {
  if (!S.session) return;
  const pending = items.filter(it => S.status[it.stream_id] === undefined);
  if (!pending.length) return;
  if (window.NativeChecker && NativeChecker.checkStream) {
    pending.forEach(it => NativeChecker.checkStream(streamUrl('live', it), String(it.stream_id)));
    return;
  }
  // Fuera de la app (navegador): aproximación, sin código de estado real.
  const gen = checkGen;
  (async () => {
    for (let i = 0; i < pending.length; i += 6) {
      if (gen !== checkGen) return;
      await Promise.all(pending.slice(i, i + 6).map(async it => {
        try {
          const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000);
          await fetch(streamUrl('live', it), { method: 'HEAD', mode: 'no-cors', signal: c.signal }); clearTimeout(t);
          window.onStreamChecked(String(it.stream_id), true);
        } catch { window.onStreamChecked(String(it.stream_id), false); }
      }));
    }
  })();
}
const refreshLiveBarSoon = debounce(updateLiveBar, 250);
window.onStreamChecked = function (id, online) {
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
  while (epgActive < 3 && epgQueue.length) {
    const sid = epgQueue.shift(); if (S.epg[sid]) continue;
    epgActive++;
    fetchEpg(sid).finally(() => { epgActive--; pumpEpg(); });
  }
}
async function fetchEpg(sid) {
  if (!S.session) return;
  const accId = S.session.id;
  let entry = { text: 'Sin guía disponible', pct: null };
  try {
    const d = await apiGet(`${S.session.apiUrl}&action=get_short_epg&stream_id=${encodeURIComponent(sid)}&limit=2`, 10000);
    const now = Date.now() / 1000;
    const list = (d.epg_listings || []).map(x => ({ t: decodeB64(x.title).trim(), s: +x.start_timestamp || 0, e: +x.stop_timestamp || 0 })).filter(x => x.t);
    const cur = list.find(x => x.e > now) || list[0];
    if (cur) {
      const pct = cur.e > cur.s ? Math.max(0, Math.min(100, (now - cur.s) / (cur.e - cur.s) * 100)) : null;
      entry = { text: `Ahora: ${cur.t}${cur.s ? ` · ${fmtTime(cur.s)}` : ''}`, pct: pct === null ? null : Math.round(pct), title: cur.t, s: cur.s, e: cur.e };
    }
  } catch { }
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
function continueItems(type) {
  let list = [];
  try { if (window.NativeApp && NativeApp.getContinueWatching) list = JSON.parse(NativeApp.getContinueWatching() || '[]'); } catch { }
  const acc = S.session; if (!acc) return [];
  const prefix = `${acc.host}/${type === 'vod' ? 'movie' : 'series'}/${acc.username}/`;
  return list.filter(x => x.url && x.url.startsWith(prefix) && x.dur > 0).slice(0, 15);
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
  let items;
  try { items = cat === 'fav' ? Object.values(favMap(type)) : await getList(type, cat); }
  catch (e) { $(`${type}-grid-wrap`).innerHTML = emptyState(type === 'vod' ? 'mov' : 'ser', 'No se pudo cargar el catálogo', e.message, `<button class="btn" onclick="loadGrid('${type}',${jsArg(cat)})">${icon('refresh')}Reintentar</button>`); return; }
  if (S.view[type] !== cat) return;
  const wrap = $(`${type}-grid-wrap`);
  if (!items.length) {
    wrap.innerHTML = cat === 'fav' ? emptyState('star', 'Aún no tienes favoritos', 'Abre una ficha y toca la estrella para guardarla aquí.') : emptyState(type === 'vod' ? 'mov' : 'ser', 'Esta categoría está vacía', 'Elige otra categoría.');
    return;
  }
  // Más recientes primero cuando el servidor da la fecha en que se agregó.
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
async function openDetail(type, it) {
  if (!it) return;
  S.detail = { type, item: it, info: null, season: null };
  const page = $('page-detail');
  page.innerHTML = detailShell(type, it, null);
  page.scrollTop = 0;
  showPage('page-detail');
  try {
    const info = type === 'vod'
      ? await apiGet(`${S.session.apiUrl}&action=get_vod_info&vod_id=${encodeURIComponent(it.stream_id)}`)
      : await apiGet(`${S.session.apiUrl}&action=get_series_info&series_id=${encodeURIComponent(it.series_id)}`);
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
  const fav = isFav(type, it);
  const loading = !info;
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
        <div class="pills">${r ? `<span class="s">★ ${r}</span>` : ''}${year ? `<span>${esc(year)}</span>` : ''}${dur ? `<span>${esc(dur)}</span>` : ''}${q ? `<span>${q}</span>` : ''}${type === 'series' && seasons.length ? `<span>${seasons.length} ${seasons.length === 1 ? 'temporada' : 'temporadas'}</span>` : ''}</div>
      </div>
    </div>
    <div class="body">
      ${genres.length || audio ? `<div class="pills" style="margin-top:14px">${genres.map(g => `<span>${esc(g)}</span>`).join('')}${audio ? `<span>Audio: ${esc(audio)}</span>` : ''}</div>` : ''}
      <div class="cta">
        ${type === 'vod'
          ? `<button class="btn primary" onclick="playVod()">${icon('play')}Reproducir</button>
             <button class="sq" onclick="addDetailToList()" aria-label="Añadir a Mi lista">${icon('plus')}</button>
             <button class="sq" onclick="copyText(${jsArg(streamUrl('vod', it))},'Enlace copiado')" aria-label="Copiar enlace">${icon('copy')}</button>`
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
  const resume = {}; continueItems('series').forEach(x => { resume[x.url] = x; });
  return `<h2 class="sec">Episodios <button onclick="addSeason(${jsArg(cur)})">Añadir temporada</button></h2>
    <div class="seasons">${seasons.map(s => `<button class="chip${s === cur ? ' on' : ''}" onclick="selectSeason(${jsArg(s)})">Temporada ${esc(s)}</button>`).join('')}</div>
    ${list.map((ep, i) => {
      const img = ep.info && (ep.info.movie_image || ep.info.cover_big);
      const url = streamUrl('episode', ep), rs = resume[url];
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
  const on = toggleFav(S.detail.type, S.detail.item);
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
  const list = S.rendered.vod.includes(item) ? S.rendered.vod : [item];
  let idx = list.indexOf(item), start = 0, slice = list;
  if (list.length > 300) { start = Math.max(0, idx - 150); slice = list.slice(start, start + 300); }
  nativePlay(slice.map(it => ({ name: cleanTitle(itemName(it)), url: streamUrl('vod', it), streamId: String(it.stream_id), isLive: false, poster: it === item ? m.thumbnail : (it.stream_icon || '') })), idx - start, 'Películas');
}
function addDetailToList() {
  const { item } = S.detail; const m = detailMeta();
  addToList({ name: cleanTitle(itemName(item)), url: streamUrl('vod', item), category: catsOf('vod').find(c => String(c.category_id) === String(item.category_id))?.category_name || 'Películas', ...m });
}
function epName(snum, i, ep) { return `${cleanTitle(itemName(S.detail.item))} T${snum}E${ep.episode_num || i + 1}${ep.title ? ' - ' + ep.title : ''}`; }
function playEpisode(snum, i) {
  if (!S.detail || !S.detail.info) return;
  const eps = (S.detail.info.episodes || {})[snum] || []; if (!eps[i]) return;
  const m = detailMeta();
  nativePlay(eps.map((ep, k) => ({ name: epName(snum, k, ep), url: streamUrl('episode', ep), streamId: String(ep.id), isLive: false, poster: (ep.info && ep.info.movie_image) || m.thumbnail })), i, 'Series');
}
function addEpisode(snum, i) {
  const ep = ((S.detail.info.episodes || {})[snum] || [])[i]; if (!ep) return;
  addToList({ name: epName(snum, i, ep), url: streamUrl('episode', ep), category: 'Series', ...detailMeta() });
}
function addSeason(snum) {
  const eps = (S.detail.info.episodes || {})[snum] || [], m = detailMeta();
  eps.forEach((ep, i) => addToList({ name: epName(snum, i, ep), url: streamUrl('episode', ep), category: 'Series', ...m }, true));
  renderMyList(); toast(`Temporada ${snum} añadida (${eps.length} episodios)`, 'ok');
}
function addWholeSeries() {
  const { item } = S.detail;
  addToList({ name: cleanTitle(itemName(item)), url: streamUrl('series', item), category: 'Series', ...detailMeta() });
}
function openSeriesAddMenu() {
  if (!S.detail || !S.detail.info) return;
  const s = S.detail.season;
  showSheet('Añadir a Mi lista', `
    ${s ? `<button class="menu-item" onclick="closeTop();addSeason(${jsArg(s)})">${icon('list')}Temporada ${esc(s)} completa</button>` : ''}
    <button class="menu-item" onclick="closeTop();addWholeSeries()">${icon('ser')}Serie completa (un solo enlace)</button>`);
}

/* ═══════════════════════════ REPRODUCTOR NATIVO ═══════════════════════════ */
function nativePlay(items, startIndex, category) {
  const payload = { apiUrl: S.session ? S.session.apiUrl : '', items, startIndex, category };
  if (window.NativePlayer && NativePlayer.play) NativePlayer.play(JSON.stringify(payload));
  else toast('El reproductor solo funciona en la app instalada', 'err');
}
window.onNativeAddToList = function (name, url, category) { addToList({ name, url, category, synopsis: '', thumbnail: '' }); };

/* ═══════════════════════════ BÚSQUEDA GLOBAL ═══════════════════════════ */
let searchType = 'all';
function openSearch() {
  if (!S.session) { toast('Primero agrega una cuenta', 'err'); switchTab('accounts'); return; }
  showPage('page-search');
  renderSearchFilters();
  setTimeout(() => $('search-input').focus(), 250);
  if (!$('search-input').value) $('search-body').innerHTML = `<div class="hint" style="padding:12px 4px">Busca por nombre en todo el catálogo de la cuenta activa. La primera búsqueda descarga el catálogo y las siguientes son instantáneas.</div>`;
}
function renderSearchFilters() {
  const f = [['all', 'Todo'], ['live', 'En vivo'], ['vod', 'Películas'], ['series', 'Series']];
  $('search-filters').innerHTML = f.map(([k, l]) => `<button class="chip${searchType === k ? ' on' : ''}" onclick="searchType='${k}';renderSearchFilters();runSearch(true)">${l}</button>`).join('');
}
const onSearchInput = debounce(() => runSearch(false), 350);
function clearSearch() { $('search-input').value = ''; $('search-clear').hidden = true; $('search-body').innerHTML = ''; $('search-input').focus(); }
let searchGen = 0;
async function runSearch(force) {
  const q = $('search-input').value.trim(); $('search-clear').hidden = !q;
  const body = $('search-body');
  if (q.length < 2) { if (force && q) toast('Escribe al menos 2 letras'); if (!q) body.innerHTML = ''; return; }
  const gen = ++searchGen;
  const types = searchType === 'all' ? ['live', 'vod', 'series'] : [searchType];
  const missing = types.filter(t => !S.lists[`${t}:*`]);
  if (missing.length) body.innerHTML = loadingHtml(`Descargando catálogo de ${missing.map(t => TYPES[t].label.toLowerCase()).join(', ')}…`);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nq = norm(q);
  const results = {};
  for (const t of types) {
    try { const all = await getList(t, '*'); results[t] = all.filter(i => norm(itemName(i)).includes(nq)); }
    catch (e) { results[t] = { error: e.message }; }
    if (gen !== searchGen) return;
  }
  S.searchResults = results;
  const total = types.reduce((n, t) => n + (Array.isArray(results[t]) ? results[t].length : 0), 0);
  if (!total && !types.some(t => results[t].error)) { body.innerHTML = emptyState('search', `Nada para “${q}”`, 'Prueba con otra palabra o revisa la ortografía.'); return; }
  let html = '';
  for (const t of types) {
    const r = results[t];
    if (r.error) { html += `<h2 class="sec">${TYPES[t].label}</h2><div class="hint">No se pudo buscar: ${esc(r.error)}</div>`; continue; }
    if (!r.length) continue;
    const limit = searchType === 'all' ? (t === 'live' ? 8 : 9) : 120;
    html += `<h2 class="sec">${TYPES[t].label} <span class="hint">${fmtNum(r.length)}</span>${searchType === 'all' && r.length > limit ? `<button onclick="searchType='${t}';renderSearchFilters();runSearch(true)">Ver todos</button>` : ''}</h2>`;
    if (t === 'live') {
      html += r.slice(0, limit).map((it, i) => `<button class="ch" onclick="playSearchLive(${i})">${logoHtml(itemName(it), it.stream_icon)}<span class="n"><b>${esc(itemName(it))}</b><small>${esc(catsOf('live').find(c => String(c.category_id) === String(it.category_id))?.category_name || '')}</small></span>${icon('play')}</button>`).join('');
    } else {
      html += `<div class="grid">${r.slice(0, limit).map((it, i) => posterHtml(t, it, `openDetail('${t}',S.searchResults.${t}[${i}])`)).join('')}</div>`;
    }
  }
  body.innerHTML = html;
}
function playSearchLive(i) {
  const r = S.searchResults.live || [];
  nativePlay(r.slice(0, 500).map(it => ({ name: itemName(it), url: streamUrl('live', it), streamId: String(it.stream_id), isLive: true, poster: it.stream_icon || '' })), Math.min(i, 499), 'Búsqueda');
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
      <button class="set-row" onclick="toggleOnlineOnly();openSettings()"><span class="n"><b>Ocultar canales caídos</b><small>En la pestaña En vivo</small></span><span class="switch${S.onlineOnly ? ' on' : ''}"></span></button>
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
  await idb.clear(); S.lists = {}; S.view = { live: null, vod: null, series: null };
  toast('Catálogos borrados', 'ok');
}

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
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.tab === 'vod' || S.tab === 'series') renderContinue(S.tab);
  if (S.tab === 'accounts') checkClipboardHint();
});
init();
