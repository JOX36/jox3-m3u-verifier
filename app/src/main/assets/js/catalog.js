'use strict';
// JOX3 Verifier — Catálogo: categorías y listas de cada cuenta.

/* ═══════════════════════════ CATÁLOGO ═══════════════════════════ */
function allCatsOf(type) { return (S.session && S.session.categories[type]) || []; }
// Categorías visibles: con el control parental bloqueado se ocultan las de adultos y las elegidas.
function catsOf(type) { const all = allCatsOf(type); return parentalLocked() ? all.filter(c => !catBlocked(type, c)) : all; }

// Lista de una categoría (o de todo el tipo con catId = '*'), con caché.
const listInflight = {};
function getList(type, catId) {
  if (!S.session) return Promise.resolve([]);
  const key = `${type}:${catId}`, pk = `${S.session.id}:${key}`;
  if (S.lists[key]) return Promise.resolve(S.lists[key]);
  // Si ya se está pidiendo la misma lista (Inicio y otra pestaña a la vez), se espera esa misma respuesta.
  if (!listInflight[pk]) listInflight[pk] = fetchList(type, catId).finally(() => { delete listInflight[pk]; });
  return listInflight[pk];
}
async function fetchList(type, catId) {
  const key = `${type}:${catId}`;
  const dbKey = `list:${S.session.id}:${key}`;
  const cached = await idb.get(dbKey);
  if (cached && Date.now() - cached.ts < TTL_STREAMS && Array.isArray(cached.items)) { S.lists[key] = cached.items; if (catId === '*') markFresh(S.session.id, type, cached.ts); return cached.items; }
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
  if (catId === '*') markFresh(S.session.id, type);
  return items;
}

/* ─── Nombres de categoría limpios, con ícono y color según el tema ─── */
// "♾️⭐NOVELAS COLOMBIANAS⚡" → "Novelas colombianas"; "CO | NOTICIAS" → "Noticias" con la etiqueta CO.
const CAT_CODES = new Set('CO MX AR ES US USA LAT LATAM CL PE VE EC BR UK GB FR IT DE PT DO PR CR PA GT HN SV NI BO PY UY CA CU EU IN TR RU NL BE CH SE NO DK PL JM IE AT AU PH JP KR COL ARG MEX CHI ESP BRA'.split(' '));
const KEEP_UP = new Set('TV HD FHD UHD 4K 8K HBO ESPN NBA NFL MLB NHL UFC WWE F1 PPV VIP TNT FOX BBC CNN MTV DW RCN TYC AXN USA UK TCM AMC HDR VOD 24/7 3D'.split(' '));
const catNameCache = new Map();
function cleanCatName(raw) {
  raw = String(raw || '');
  if (catNameCache.has(raw)) return catNameCache.get(raw);
  let s = raw.replace(/[^\p{L}\p{N}\s&+'.\/!?,:-]/gu, ' ').replace(/\s+/g, ' ').trim();
  let cc = '';
  const m = s.match(/^([A-Za-z]{2,5})\s*[-:.|/]?\s+(.+)$/);
  if (m && CAT_CODES.has(m[1].toUpperCase()) && /\p{L}{3}/u.test(m[2])) { cc = m[1].toUpperCase(); s = m[2]; }
  s = s.replace(/^[\s\-:.,/|!]+|[\s\-:.,/|]+$/g, '').trim();
  // Todo en mayúsculas → "Así, en tipo oración", conservando siglas conocidas.
  if (s && !/\p{Ll}/u.test(s)) {
    let first = true;
    s = s.split(' ').map(w => {
      const up = w.toUpperCase();
      if (KEEP_UP.has(up) || /\d/.test(w)) return up;
      const lw = w.toLowerCase();
      if (first && /\p{L}/u.test(w)) { first = false; return lw.charAt(0).toUpperCase() + lw.slice(1); }
      return lw;
    }).join(' ');
  }
  const out = { name: s || raw.trim() || 'Sin nombre', cc };
  catNameCache.set(raw, out);
  return out;
}
const CAT_THEMES = [
  ['adult', null, 'lock', '#6b2f45', '#2a1018'],
  ['loop', /24\s*\/?\s*7|24x7|24 horas/, 'loop', '#4f6a86', '#1b2633'],
  ['kids', /infantil|kid|nin[oa]s|cartoon|disney|nick|junior|animad|anime|dibujo|bebe|baby|peque/, 'kid', '#d39a1d', '#5a3a08'],
  ['sport', /deport|sport|futbol|soccer|liga|league|champions|copa |espn|tyc|win|dazn|nba|nfl|mlb|nhl|ufc|wwe|box|f1|formula|motor|tenis|golf|ppv|beisbol|basket|ciclismo|toros|gol/, 'ball', '#1f8a4c', '#0d3d24'],
  ['news', /notic|news|informa|cnn|politic|24h/, 'news', '#2563b8', '#0f2a52'],
  ['music', /music|musica|radio|mtv|vevo|concierto|karaoke|reggaeton|salsa|vallenato|rock|pop/, 'music', '#c2457a', '#4d1530'],
  ['doc', /docu|discovery|nat ?geo|history|historia|animal|natur|ciencia|cultura|viaje|travel|cocina|food|planeta/, 'globe', '#2a8f8a', '#0e3b3a'],
  ['novela', /novela|dorama|k-?drama|turca|telenov/, 'heart', '#bf4a2b', '#4a170c'],
  ['faith', /relig|cristian|catolic|iglesia|evangel|biblia|fe /, 'star-o', '#8a7a3a', '#3a3214'],
  ['uhd', /\b(4k|uhd|hdr|8k)\b/, 'hd', '#0e7490', '#082f3c'],
  ['movie', /cine|movie|pelic|film|hbo|cinema|estreno|accion|terror|comedia|drama|suspenso|romance|ficcion|thriller|oscar|saga|marvel|western|belic|animacion|clasic/, 'film', '#9a3fc4', '#3b1352'],
  ['series', /serie|temporada|show|reality/, 'ser', '#3f5fc4', '#17244f'],
  ['country', /colombia|mexic|argentin|espan|chile|peru|venezuel|ecuador|estados unidos|latin|latam|local|nacional|regional|abierto|tdt|caribe|centroam|brasil|portugal|italia|franc|alemania|usa|eeuu/, 'flag', '#1f7a5a', '#0b3527'],
];
function catTheme(type, name, cc) {
  const n = ' ' + normTxt(name) + ' ';
  for (const [id, rx, ic, a, b] of CAT_THEMES) {
    if (id === 'adult' ? ADULT_RX.test(name) : rx.test(n)) return { id, ic, a, b };
  }
  if (cc) return { id: 'country', ic: 'flag', a: '#1f7a5a', b: '#0b3527' };
  const h = hue(name);
  return { id: 'other', ic: type === 'live' ? 'tv' : type === 'vod' ? 'mov' : 'ser', a: `hsl(${h},38%,34%)`, b: `hsl(${h},42%,13%)` };
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
