'use strict';
// JOX3 Verifier — Películas y series, ficha y apertura del reproductor nativo.

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
function continueItems(type, sess) { return continueAll(sess || S.session).filter(x => x.type === type).slice(0, 15); }
function continueHtml(type) {
  const list = continueItems(type);
  if (!list.length) return '';
  return `<h2 class="sec">Continuar viendo</h2><div class="rail">${list.map((x, i) => cwHtml(x, `resumeItem('${type}',${i})`)).join('')}</div>`;
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
    <div id="${type}-grid-wrap">${skelGrid()}</div>`;
  const on = body.querySelector('.chips .chip.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (cat === '*') { $(`${type}-grid-wrap`).innerHTML = categoryListHtml(type); return; }
  let items;
  try { items = cat === 'fav' ? Object.values(favMap(type)) : await getList(type, cat === 'new' ? '*' : cat); }
  catch (e) { if (S.view[type] === cat) $(`${type}-grid-wrap`).innerHTML = errorState(type === 'vod' ? 'mov' : 'ser', e, `loadGrid('${type}',${jsArg(cat)})`); return; }
  if (S.view[type] !== cat) return;
  const wrap = $(`${type}-grid-wrap`);
  if (!items.length) {
    wrap.innerHTML = cat === 'fav' ? emptyState('star', 'Aún no tienes favoritos', 'Abre una ficha y toca la estrella para guardarla aquí.') : emptyState(type === 'vod' ? 'mov' : 'ser', 'Esta categoría está vacía', 'Elige otra categoría.');
    return;
  }
  // Más recientes primero cuando el servidor da la fecha en que se agregó.
  items = cat === 'new' ? newestOf(type, items, 300) : filterAllowed(type, items);
  if (cat !== 'new' && items[0] && items[0].added) items = [...items].sort((a, b) => (+b.added || 0) - (+a.added || 0));
  S.rendered[type] = items;
  wrap.innerHTML = `<div class="hint" style="margin-bottom:10px">${fmtNum(items.length)} ${type === 'vod' ? 'películas' : 'series'}</div><div class="grid" id="${type}-grid"></div><div class="more-sentinel" id="${type}-more"></div>`;
  S[`${type}Shown`] = 0;
  appendGrid(type);
  if (gridObserver[type]) gridObserver[type].disconnect();
  gridObserver[type] = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) appendGrid(type); }, { root: body, rootMargin: '800px' });
  gridObserver[type].observe($(`${type}-more`));
}
function posterHtml(type, it, onclick, attrs = '', tag = false) {
  const img = itemImg(type, it), r = rating(it), q = quality(it.name), name = cleanTitle(itemName(it));
  return `<button class="po${img ? '' : ' noimg'}" onclick="${onclick}" ${attrs}>${img ? `<img src="${esc(img)}" loading="lazy" alt="" onerror="this.parentNode.classList.add('noimg');this.remove()">` : ''}
    ${r ? `<span class="r">★ ${r}</span>` : ''}${q ? `<span class="q">${q}</span>` : ''}<span class="t">${tag ? typeTag(type) : ''}${esc(name)}</span>${isFav(type, it) ? `<span class="fv">${icon('star')}</span>` : ''}</button>`;
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
/* ─── Ficha teñida con el color de la portada ─── */
const tintCache = {};
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
// Color dominante "vivo" de la portada: se agrupan los píxeles por tono y gana el más presente y saturado.
function posterColor(img) {
  const c = document.createElement('canvas'); c.width = 24; c.height = 36;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 36);
  const px = x.getImageData(0, 0, 24, 36).data, bins = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (l < .12 || l > .9) continue;
    const w = s * (1 - Math.abs(l - .5) * 1.4);
    const b = bins[Math.floor(h / 30) % 12]; b.w += w; b.h += h * w; b.s += s * w;
  }
  const best = bins.reduce((a, b) => b.w > a.w ? b : a);
  if (best.w < 3) return null;   // casi en blanco y negro
  return { h: Math.round(best.h / best.w), s: best.s / best.w };
}
function setTint(page, t) {
  if (!t) { page.classList.remove('tinted'); return; }
  const s = Math.round(Math.min(.62, Math.max(.32, t.s)) * 100);
  page.style.setProperty('--tint-m', `hsl(${t.h},${s}%,22%)`);
  page.style.setProperty('--tint-d', `hsl(${t.h},${Math.round(s * .8)}%,12%)`);
  page.style.setProperty('--tint-b', `hsl(${t.h},${Math.max(s, 55)}%,66%)`);
  page.classList.add('tinted');
}
function applyTint(page, url, name) {
  const fallback = () => setTint(page, { h: hue(name), s: .4 });
  page.dataset.tint = url || '';
  if (!url) { fallback(); return; }
  if (tintCache[url] !== undefined) { tintCache[url] ? setTint(page, tintCache[url]) : fallback(); return; }
  const im = new Image();
  im.onload = () => {
    let t = null;
    try { t = posterColor(im); } catch { t = null; }   // si la imagen no se deja leer, color según el nombre
    tintCache[url] = t;
    if (page.dataset.tint === url) { t ? setTint(page, t) : fallback(); }
  };
  im.onerror = () => { tintCache[url] = null; fallback(); };
  im.src = url;
}
// La ficha "crece" desde la portada que tocaste.
const lastTap = { r: null, t: 0 };
document.addEventListener('click', e => {
  const p = e.target && e.target.closest && e.target.closest('.po, .hero-card');
  if (p) { lastTap.r = p.getBoundingClientRect(); lastTap.t = Date.now(); }
}, true);
function growFromTap(page) {
  const r = lastTap.r;
  if (!r || Date.now() - lastTap.t > 800 || !page.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  lastTap.r = null;
  const W = innerWidth, Hh = innerHeight;
  const from = `inset(${Math.max(0, r.top)}px ${Math.max(0, W - r.right)}px ${Math.max(0, Hh - r.bottom)}px ${Math.max(0, r.left)}px round 12px)`;
  page.style.transition = 'none';
  try {
    const a = page.animate([{ clipPath: from, opacity: .4 }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
    a.onfinish = a.oncancel = () => { page.style.transition = ''; };
  } catch { page.style.transition = ''; }
}


async function openDetail(type, it, accId) {
  if (!it) return;
  accId = accId || S.activeId;
  const sess = sessionFor(accId);
  S.detail = { type, item: it, info: null, season: null, accId, sess };
  const page = $('page-detail');
  page.innerHTML = detailShell(type, it, null);
  page.scrollTop = 0;
  page.classList.remove('tinted');
  applyTint(page, itemImg(type, it), itemName(it));
  growFromTap(page);
  showPage('page-detail');
  try {
    const info = type === 'vod'
      ? await apiGet(`${sess.apiUrl}&action=get_vod_info&vod_id=${encodeURIComponent(it.stream_id)}`, 25000, { noBrake: accId !== S.activeId })
      : await apiGet(`${sess.apiUrl}&action=get_series_info&series_id=${encodeURIComponent(it.series_id)}`, 25000, { noBrake: accId !== S.activeId });
    if (!S.detail || S.detail.item !== it) return;
    S.detail.info = info || {};
    page.innerHTML = detailShell(type, it, S.detail.info);
    if (!itemImg(type, it)) { const inf = S.detail.info.info || {}; applyTint(page, inf.cover_big || inf.movie_image || '', itemName(it)); }
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
    <div class="hero">${back ? `<img class="bg${back === poster ? ' blur' : ''}" src="${esc(back)}" alt="" onerror="this.remove()">` : ''}
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
