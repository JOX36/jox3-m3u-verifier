'use strict';
// JOX3 Verifier — Pantalla de cuentas, control parental y diagnóstico.

/* ═══════════════════════════ PANTALLA: CUENTAS ═══════════════════════════ */
function meterHtml(acc) {
  const d = daysLeft(acc), lvl = accLevel(acc);
  const filled = acc.status !== 'Active' ? 0 : d === null ? 30 : Math.max(0, Math.min(30, d));
  return `<div class="meter ${lvl === 'on' ? '' : lvl}">${Array.from({ length: 30 }, (_, i) => `<i class="${i < filled ? 'f' : ''}"></i>`).join('')}</div>`;
}
function renderAccounts(el = $('accounts-body')) {
  const acc = activeAccount();
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
    bulk.current = a.id; refreshAccountsUI();
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
  updateAppbar(); refreshAccountsUI();
  pushExpiryWatch();
  const sum = expirySummary(S.accounts);
  toast(`${ok} verificadas${fail ? ` · ${fail} sin respuesta` : ''}${sum.expired ? ` · ${sum.expired} vencidas` : ''}${sum.soon ? ` · ${sum.soon} por vencer` : ''}`, fail ? 'err' : 'ok');
}
function deleteExpired(sure) {
  const exp = S.accounts.filter(a => a.status && (a.status !== 'Active' || (daysLeft(a) !== null && daysLeft(a) < 0)));
  if (!exp.length) return;
  if (!sure) { askConfirm(`Eliminar ${exp.length} ${exp.length === 1 ? 'cuenta vencida' : 'cuentas vencidas'}`, esc(exp.map(a => a.username).join(', ')), 'Eliminar', () => deleteExpired(true)); return; }
  const ids = new Set(exp.map(a => a.id));
  S.accounts = S.accounts.filter(a => !ids.has(a.id)); saveAccounts();
  ids.forEach(id => delete S.favs[id]); saveFavs();
  if (ids.has(S.activeId)) { S.activeId = null; S.session = null; S.cfg.activeId = null; saveCfg(); if (S.accounts[0]) activateAccount(S.accounts[0].id); }
  updateAppbar(); refreshAccountsUI(); pushExpiryWatch();
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
    refreshAccountsUI(); updateAppbar();
    toast(`${a.username}: ${accDaysLabel(accountById(id))}`, 'ok');
  } catch (e) { toast(`${a.username}: ${e.message}`, 'err'); }
}

function openAccountSwitcher() {
  const rows = S.accounts.map(a => `<button class="row" onclick="closeTop();activateAccount(${jsArg(a.id)})">
      <span class="dot ${accLevel(a)}"></span>
      <span class="n"><b>${esc(a.username)}</b><small>${esc(hostLabel(a.host))}</small></span>
      <span class="end" style="color:var(--${accLevel(a) === 'muted' ? 'muted' : accLevel(a)})">${a.id === S.activeId ? icon('check') : esc(accDaysLabel(a, true))}</span>
    </button>`).join('');
  showSheet('Cambiar de cuenta', rows + `<button class="menu-item" onclick="closeTop();openAccounts()">${icon('acc')}Administrar cuentas</button><button class="add-card" onclick="closeTop();openAddAccount()"><span class="ic">${icon('plus')}</span><span><b>Agregar cuenta</b><small>Pega un enlace M3U o ingresa los datos</small></span></button>`);
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
    refreshAccountsUI();
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
    if (accountsOpen()) renderAccounts(); else switchTab('home');
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
  refreshAccountsUI();
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
  withParental(() => askConfirm('Desactivar control parental', 'Se vuelven a mostrar todas las categorías, también las de adultos.', 'Desactivar', () => { const p = pc(); p.on = false; saveCfg(); toast('Control parental desactivado'); resetCatalogViews(); }));
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
