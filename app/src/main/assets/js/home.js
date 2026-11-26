'use strict';
// JOX3 Verifier — Pantalla de inicio.

/* ═══════════════════════════ PANTALLA: INICIO ═══════════════════════════ */
// Arriba el estado de la cuenta (lo propio de esta app); debajo, lo nuevo del servidor y tus cosas.
const H = { gen: 0, hero: [], idx: 0, timer: null, rows: {}, cont: [], info: {}, focusT: null, cur: null };

function renderHome() {
  const el = $('home-body');
  stopHero();
  if (!S.accounts.length) { el.classList.remove('home'); renderAccounts(el); return; }
  el.classList.add('home');
  const gen = ++H.gen, top = el.scrollTop;
  el.innerHTML = `<div id="home-acc"></div><div id="home-hero"></div><div id="home-cont"></div><div id="home-rows"></div>`;
  renderHomeAccount();
  if (!S.session) return;
  renderHomeContinue();
  renderHomeRows(gen).then(() => { if (gen === H.gen && top) el.scrollTop = top; });
}

function renderHomeAccount() {
  const box = $('home-acc'); if (!box) return;
  const acc = activeAccount();
  if (!acc) { box.innerHTML = ''; return; }
  const d = daysLeft(acc), lvl = accLevel(acc), g = acc.geo || {};
  const big = acc.status !== 'Active' ? '0' : d === null ? '∞' : Math.max(d, 0);
  const lbl = acc.status !== 'Active' ? esc(accDaysLabel(acc)) : d === null ? 'sin vencimiento' : `${d === 1 ? 'día' : 'días'}<small>vence ${esc(fmtDate(tsDate(acc.expDate)))}</small>`;
  const sum = expirySummary(S.accounts), n = S.accounts.length;
  const part = (k, c, one, many) => c ? ` · <em class="${k}">${c} ${c === 1 ? one : many}</em>` : '';
  const foot = n > 1 ? `${n} cuentas${part('on', sum.ok, 'al día', 'al día')}${part('warn', sum.soon, 'por vencer', 'por vencer')}${part('off', sum.expired, 'vencida', 'vencidas')}`
    : acc.isTrial ? 'Cuenta de prueba' : 'Tu cuenta';
  const cons = `${esc(acc.activeCons ?? 0)} de ${esc(acc.maxCons ?? 0)} conexiones`;
  box.innerHTML = `<div class="hacc">
    <button class="hacc-main" onclick="openAccounts()">
      <span class="dot ${lvl}"></span>
      <span class="n"><b>${esc(acc.username)}</b><small>${esc(hostLabel(acc.host))}${g.countryCode ? ' · ' + flagEmoji(g.countryCode) : ''}</small></span>
      <span class="hacc-days ${lvl}"><b>${big}</b><span>${lbl}</span></span>
    </button>
    ${meterHtml(acc)}
    <div class="hacc-foot"><span class="hacc-sum">${n > 1 ? foot : `${foot} · ${cons}`}</span>
      ${n > 1 ? `<button class="btn sm" onclick="openAccountSwitcher()">Cambiar</button>` : ''}
      <button class="btn sm" onclick="openAccounts()">${icon('acc')}Cuentas</button></div>
  </div>`;
}

/* Continuar viendo (películas y episodios de esta cuenta, lo último primero) */
function continueAll(sess = S.session) {
  if (!sess) return [];
  let list = [];
  try { if (window.NativeApp && NativeApp.getContinueWatching) list = JSON.parse(NativeApp.getContinueWatching() || '[]'); } catch { }
  const pv = `${sess.host}/movie/${sess.username}/`, ps = `${sess.host}/series/${sess.username}/`;
  return list.filter(x => x.url && x.dur > 0 && (x.url.startsWith(pv) || x.url.startsWith(ps)) && !(parentalLocked() && ADULT_RX.test(x.name || '')))
    .slice(0, 40).map(x => ({ ...x, type: x.url.startsWith(pv) ? 'vod' : 'series' }));
}
const TYPE_LABEL = { vod: 'Película', series: 'Serie', live: 'TV' };
function typeTag(type) { return TYPE_LABEL[type] ? `<em class="tb tb-${type}">${TYPE_LABEL[type]}</em>` : ''; }
function cwHtml(x, onclick) {
  const left = Math.max(1, Math.round((x.dur - x.pos) / 60000));
  return `<button class="cw" onclick="${onclick}"><div class="img">${x.poster ? `<img src="${esc(x.poster)}" loading="lazy" alt="" onerror="this.remove()">` : ''}${x.type ? typeTag(x.type) : ''}<span class="pl">${icon('play')}</span><i style="width:${Math.round(x.pos / x.dur * 100)}%"></i></div><b>${esc(x.name)}</b><small>Quedan ${left} min</small></button>`;
}
function renderHomeContinue() {
  const box = $('home-cont'); if (!box) return;
  const list = H.cont = continueAll().slice(0, 20);
  box.innerHTML = list.length ? `<section class="hrow"><h2 class="sec">Continuar viendo</h2><div class="rail">${list.map((x, i) => cwHtml(x, `homeResume(${i})`)).join('')}</div></section>` : '';
}
/* Últimos canales en vivo vistos (los guarda el reproductor, también al cambiar de canal ahí) */
function recentLiveItems(sess = S.session) {
  if (!sess) return [];
  let list = [];
  try { if (window.NativeApp && NativeApp.getRecentLive) list = JSON.parse(NativeApp.getRecentLive() || '[]'); } catch { }
  const pre = `${sess.host}/live/${sess.username}/`;
  return list.filter(x => x.url && x.url.startsWith(pre) && x.streamId && !(parentalLocked() && ADULT_RX.test(x.name || '')))
    .slice(0, 15).map(x => ({ stream_id: x.streamId, name: x.name, stream_icon: x.poster || '', epg_channel_id: x.epgId || '' }));
}
function renderHomeRecent() {
  const box = $('hr-recent'); if (!box) return;
  const recent = recentLiveItems();
  box.innerHTML = recent.length ? liveRowHtml(recent, 'recent', 'Vistos hace poco', '') : '';
  if (S.cfg.showEpg !== false && (!S.epgOff || extOn())) { recent.slice(0, 8).forEach(it => { if (!S.epg[it.stream_id]) epgQueue.push(String(it.stream_id)); }); pumpEpg(); }
}
function homeResume(i) {
  const x = H.cont[i]; if (!x) return;
  nativePlay([{ name: x.name, url: x.url, streamId: x.streamId || '', isLive: false, poster: x.poster || '' }], 0, x.type === 'vod' ? 'Películas' : 'Series');
}

/* Filas */
function skelRow(title) {
  return `<section class="hrow"><h2 class="sec">${esc(title)}</h2><div class="rail">${'<div class="po skel"></div>'.repeat(7)}</div></section>`;
}
function posterRow(key, type, title, items, moreJs) {
  if (!items.length) return '';
  H.rows[key] = { type, items };
  return `<section class="hrow"><h2 class="sec">${esc(title)}${moreJs ? `<button onclick="${moreJs}">Ver todas</button>` : ''}</h2>
    <div class="rail">${items.map((it, i) => posterHtml(type, it, `homeOpen('${key}',${i})`, `data-hk="${key}" data-hi="${i}"`, true)).join('')}</div></section>`;
}
function homeItem(key, i) { const r = H.rows[key]; return r && r.items[i] ? { type: r.type, it: r.items[i] } : null; }
function homeOpen(key, i) { const h = homeItem(key, i); if (h) openDetail(h.type, h.it); }
function liveRowHtml(items, key = 'live', title = 'Tus canales ahora', moreJs = `switchTab('live',{cat:'fav'})`) {
  H.rows[key] = { type: 'live', items };
  return `<section class="hrow"><h2 class="sec"><span class="live-ttl"><i class="live-dot"></i>${esc(title)}</span>${moreJs ? `<button onclick="${moreJs}">Ver todos</button>` : ''}</h2>
    <div class="rail">${items.map((it, i) => {
      noteCh(it);
      const sid = it.stream_id, e = S.epg[sid], noEpg = S.cfg.showEpg === false || (S.epgOff && !extOn());
      return `<button class="lc${key === 'recent' && i === 0 ? ' last' : ''}" onclick="homePlayLive(${i},'${key}')">${logoHtml(itemName(it), it.stream_icon)}<span class="n">${key === 'recent' && i === 0 ? '<em class="tb tb-live">Último visto</em>' : ''}<b>${esc(itemName(it))}</b>
        <small class="epg" data-sid="${esc(sid)}">${e ? esc(e.text) : noEpg ? esc(catName('live', it.category_id) || 'En vivo') : 'Buscando qué están pasando…'}</small>${e && e.pct != null ? `<span class="p"><i style="width:${e.pct}%"></i></span>` : ''}</span></button>`;
    }).join('')}</div></section>`;
}
function homePlayLive(i, key = 'live') {
  const items = (H.rows[key] || {}).items || []; if (!items[i]) return;
  nativePlay(items.map(it => ({ name: itemName(it), url: streamUrl('live', it), streamId: String(it.stream_id), isLive: true, poster: it.stream_icon || '', epgId: it.epg_channel_id || '' })), i, key === 'recent' ? 'Vistos hace poco' : 'Favoritos');
}
function newestOf(type, items, n = 24) {
  const key = type === 'vod' ? 'added' : 'last_modified';
  const ts = it => +it[key] || +it.added || 0;
  return filterAllowed(type, items).filter(it => itemImg(type, it))
    .sort((a, b) => ts(b) - ts(a) || (+itemId(type, b) || 0) - (+itemId(type, a) || 0)).slice(0, n);
}
async function renderHomeRows(gen) {
  const box = $('home-rows'); if (!box) return;
  const favLive = filterAllowed('live', Object.values(favMap('live'))).slice(0, 20);
  const favVod = filterAllowed('vod', Object.values(favMap('vod')));
  const favSer = filterAllowed('series', Object.values(favMap('series')));
  const showNew = S.cfg.homeNew !== false;
  H.rows = {};
  const recent = recentLiveItems();
  box.innerHTML = `<div id="hr-recent">${recent.length ? liveRowHtml(recent, 'recent', 'Vistos hace poco', '') : ''}</div>
    ${favLive.length ? liveRowHtml(favLive) : ''}
    <div id="hr-vod">${showNew ? skelRow('Nuevas películas') : ''}</div>
    <div id="hr-series">${showNew ? skelRow('Nuevas series') : ''}</div>
    ${posterRow('fvod', 'vod', 'Películas favoritas', favVod, `switchTab('vod',{cat:'fav'})`)}
    ${posterRow('fseries', 'series', 'Series favoritas', favSer, `switchTab('series',{cat:'fav'})`)}`;
  if (S.cfg.showEpg !== false && (!S.epgOff || extOn())) { [...recent.slice(0, 8), ...favLive.slice(0, 12)].forEach(it => { if (!S.epg[it.stream_id]) epgQueue.push(String(it.stream_id)); }); pumpEpg(); }
  const heroFrom = list => list.slice(0, 6);
  if (!showNew) { setHero(heroFrom([...favVod.map(it => ({ type: 'vod', it })), ...favSer.map(it => ({ type: 'series', it }))])); return; }
  $('home-hero').innerHTML = `<div class="hero-card skel"></div>`;
  let hero = [];
  for (const type of ['vod', 'series']) {
    let top = [];
    try { top = newestOf(type, await getList(type, '*')); } catch { }
    if (gen !== H.gen) return;
    const slot = $(`hr-${type}`); if (!slot) return;
    // Las 6 primeras van al banner; la fila sigue con el resto.
    if (!hero.length && top.length) { hero = top.slice(0, 6).map(it => ({ type, it })); setHero(hero); }
    const rest = hero.length && hero[0].type === type && top.length > 12 ? top.slice(6) : top;
    slot.innerHTML = posterRow(`n${type}`, type, type === 'vod' ? 'Nuevas películas' : 'Nuevas series', rest, `switchTab('${type}',{cat:'new'})`);
  }
  if (!hero.length) setHero(heroFrom(favVod.map(it => ({ type: 'vod', it }))));
}

/* Banner de estrenos: rota solo cada 7 s; en TV muestra lo que tengas seleccionado. */
function yearOf(it) {
  const y = String(it.year || it.releaseDate || it.release_date || '').match(/\d{4}/) || String(itemName(it)).match(/\((\d{4})\)/);
  return y ? (y[1] || y[0]) : '';
}
function catName(type, id) {
  const c = allCatsOf(type).find(c => String(c.category_id) === String(id));
  return c ? cleanCatName(c.category_name).name : '';
}
function agoLabel(ts) {
  ts = +ts; if (!ts) return '';
  const d = Math.floor((Date.now() - ts * 1000) / 86400000);
  if (d < 0 || d > 45) return '';
  return d === 0 ? 'agregada hoy' : d === 1 ? 'agregada ayer' : `agregada hace ${d} días`;
}
function heroKey(h) { return `${h.type}:${itemId(h.type, h.it)}`; }
function heroInfoHtml(h) {
  const it = h.it, type = h.type, r = rating(it), y = yearOf(it), q = quality(itemName(it)), c = catName(type, it.category_id);
  const ago = agoLabel(type === 'vod' ? it.added : (it.last_modified || it.added)), inf = H.info[heroKey(h)];
  const multi = H.hero.length > 1 && !H.cur;
  return `<span class="tagline">${H.cur ? (type === 'vod' ? 'Película' : 'Serie') : `${type === 'vod' ? 'Película nueva' : 'Serie nueva'}${ago ? ' · ' + ago : ''}`}</span>
    <h1>${esc(cleanTitle(itemName(it)))}</h1>
    <div class="hmeta">${r ? `<span class="s">★ ${r}</span>` : ''}${y ? `<span>${esc(y)}</span>` : ''}${c ? `<span>${esc(c)}</span>` : ''}${q ? `<span>${q}</span>` : ''}</div>
    ${inf && inf.plot ? `<p class="hplot">${esc(inf.plot)}</p>` : ''}
    <div class="hctas"><button class="btn hplay" onclick="event.stopPropagation();heroPlay()">${icon('play')}${type === 'vod' ? 'Ver ahora' : 'Ver episodios'}</button>
      <button class="btn hglass" onclick="event.stopPropagation();heroMore()">${icon('info')}Detalles</button></div>
    ${multi ? `<div class="hdots">${H.hero.map((_, i) => `<i class="${i === H.idx ? 'on' : ''}"></i>`).join('')}</div>` : ''}`;
}
function heroCurrent() { return H.cur || H.hero[H.idx] || null; }
function setHero(list) {
  stopHero(); H.hero = list || []; H.idx = 0; H.cur = null;
  const box = $('home-hero'); if (!box) return;
  if (!H.hero.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="hero-card" id="hero-card" onclick="heroMore()">
      <img class="hb" id="hero-bg" alt="" onerror="this.style.visibility='hidden'">
      <img class="hpo" id="hero-po" alt="" onerror="this.style.visibility='hidden'">
      <div class="hfade"></div><div class="hinfo" id="hero-info"></div></div>`;
  paintHero();
  const card = $('hero-card'); let x0 = null;
  card.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  card.addEventListener('touchend', e => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50 && H.hero.length > 1) { H.cur = null; goHero(H.idx + (dx < 0 ? 1 : -1)); startHero(); }
  }, { passive: true });
  startHero();
}
function paintHero() {
  const h = heroCurrent(); if (!h || !$('hero-card')) return;
  const bg = $('hero-bg'), po = $('hero-po'), inf = H.info[heroKey(h)], poster = itemImg(h.type, h.it);
  const back = inf && inf.back;
  $('hero-card').classList.toggle('has-back', !!back);
  bg.style.visibility = ''; po.style.visibility = '';
  bg.src = back || poster || ''; po.src = poster || '';
  $('hero-info').innerHTML = heroInfoHtml(h);
  $('hero-card').classList.remove('swap'); void $('hero-card').offsetWidth; $('hero-card').classList.add('swap');
  if (window.IS_TV && !inf) fetchHeroInfo(h);
}
function goHero(i) { if (!H.hero.length) return; H.idx = (i + H.hero.length) % H.hero.length; paintHero(); }
function startHero() {
  stopHero();
  if (H.hero.length < 2) return;
  H.timer = setInterval(() => {
    if (document.hidden || S.tab !== 'home' || S.stack.length || H.cur) return;
    const hb = $('home-hero'); if (!hb) return;
    if (hb.contains(document.activeElement) && document.activeElement !== document.body) return;
    goHero(H.idx + 1);
  }, 7000);
}
function stopHero() { if (H.timer) { clearInterval(H.timer); H.timer = null; } }
function heroPlay() {
  const h = heroCurrent(); if (!h) return;
  if (h.type !== 'vod') { openDetail(h.type, h.it); return; }
  nativePlay([{ name: cleanTitle(itemName(h.it)), url: streamUrl('vod', h.it), streamId: String(h.it.stream_id), isLive: false, poster: itemImg('vod', h.it) }], 0, 'Películas');
}
function heroMore() { const h = heroCurrent(); if (h) openDetail(h.type, h.it); }
// TV: el fondo y la sinopsis se piden solo para lo que dejas seleccionado un momento.
const heroInfoQueue = { busy: false, next: null };
function fetchHeroInfo(h) {
  heroInfoQueue.next = h;
  clearTimeout(H.focusT);
  H.focusT = setTimeout(async function run() {
    if (heroInfoQueue.busy || !heroInfoQueue.next || !S.session || isRejecting()) return;
    const cur = heroInfoQueue.next; heroInfoQueue.next = null;
    const k = heroKey(cur); if (H.info[k]) return;
    heroInfoQueue.busy = true;
    try {
      const d = await apiGet(`${S.session.apiUrl}&action=${cur.type === 'vod' ? 'get_vod_info&vod_id' : 'get_series_info&series_id'}=${encodeURIComponent(itemId(cur.type, cur.it))}`, 15000);
      const inf = (d && d.info) || {};
      const back = Array.isArray(inf.backdrop_path) ? inf.backdrop_path[0] : inf.backdrop_path;
      H.info[k] = { back: back || '', plot: String(inf.plot || inf.description || '').trim() };
    } catch { H.info[k] = { back: '', plot: '' }; }
    heroInfoQueue.busy = false;
    const now = heroCurrent(); if (now && heroKey(now) === k) paintHero();
    if (heroInfoQueue.next) H.focusT = setTimeout(run, 400);
  }, 800);
}
document.addEventListener('focusin', e => {
  if (!window.IS_TV || S.tab !== 'home' || S.stack.length) return;
  const p = e.target.closest && e.target.closest('[data-hk]'); if (!p) return;
  const h = homeItem(p.dataset.hk, +p.dataset.hi); if (!h) return;
  if (H.cur && heroKey(H.cur) === heroKey(h)) return;
  H.cur = h; stopHero(); paintHero();
});
