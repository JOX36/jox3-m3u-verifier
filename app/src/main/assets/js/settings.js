'use strict';
// JOX3 Verifier — Ajustes, alertas de vencimiento y actualizaciones.

/* ═══════════════════════════ AJUSTES ═══════════════════════════ */
function openSettings() {
  const st = TAB_TITLES[S.cfg.startTab] || S.cfg.startTab === 'last' ? S.cfg.startTab : 'home';
  const opt = (v, l) => `<option value="${v}"${st === v ? ' selected' : ''}>${l}</option>`;
  $('settings-body').innerHTML = `
    <div class="set-title">General</div>
    <div class="set-group">
      <div class="set-row"><span class="n"><b>Pantalla de inicio</b><small>La que se abre al entrar a la app</small></span>
        <select onchange="S.cfg.startTab=this.value;saveCfg();toast('Guardado','ok')">${opt('home', 'Inicio')}${opt('live', 'En vivo')}${opt('vod', 'Películas')}${opt('series', 'Series')}${opt('mylist', 'Mi lista')}${opt('last', 'La última que usé')}</select></div>
      <button class="set-row" onclick="S.cfg.autoCheck=!S.cfg.autoCheck;saveCfg();openSettings()"><span class="n"><b>Verificar canales automáticamente</b><small>Al abrir una categoría. Algunos servidores bloquean la IP si se verifican muchos canales; si pasa, déjalo apagado y usa el botón Verificar canales.</small></span><span class="switch${S.cfg.autoCheck ? ' on' : ''}"></span></button>
      <button class="set-row" onclick="S.cfg.showEpg=S.cfg.showEpg===false;saveCfg();openSettings()"><span class="n"><b>Mostrar la guía en la lista</b><small>Lo que están pasando en cada canal</small></span><span class="switch${S.cfg.showEpg !== false ? ' on' : ''}"></span></button>
      <button class="set-row" onclick="S.cfg.homeNew=S.cfg.homeNew===false;saveCfg();openSettings();if(S.tab==='home')renderHome()"><span class="n"><b>Estrenos en Inicio</b><small>Descarga el catálogo una vez cada 6 horas para mostrar lo nuevo. Apágalo si tu TV box es lento.</small></span><span class="switch${S.cfg.homeNew !== false ? ' on' : ''}"></span></button>
      <button class="set-row" onclick="S.cfg.preload=S.cfg.preload===false;saveCfg();schedulePreload(5000);openSettings()"><span class="n"><b>Descargar catálogos en segundo plano</b><small>${(() => { const p = preloadStatus(); return `Despacio y con pausas, para que la búsqueda sea rápida. ${p.total ? `Listos ${p.ok} de ${p.total}.` : ''}`; })()}</small></span><span class="switch${S.cfg.preload !== false ? ' on' : ''}"></span></button>
      ${window.NativeEpg ? `<button class="set-row" onclick="S.cfg.extEpg=S.cfg.extEpg===false;saveCfg();if(S.cfg.extEpg!==false)ensureExtEpg();openSettings()"><span class="n"><b>Guía de internet</b><small>Para los canales que tu servidor deja sin guía. ${(() => { try { const st = JSON.parse(NativeEpg.status()); return st.loading ? 'Descargando…' : st.ready ? `${fmtNum(st.channels)} canales disponibles.` : ''; } catch { return ''; } })()}</small></span><span class="switch${S.cfg.extEpg !== false ? ' on' : ''}"></span></button>
      ${S.cfg.extEpg !== false ? `<button class="set-row" onclick="openExtCountries()"><span class="n"><b>Países de la guía</b><small>${esc(extCountryFiles().map(f => (EXT_COUNTRIES.find(c => c[0] === f) || [f, f])[1]).join(', ') || 'Ninguno')}</small></span>${icon('chev', 'chev')}</button>` : ''}` : ''}
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
// Novedades de la versión, tal como vienen publicadas: una por renglón, sin marcas de formato.
function releaseNotes(txt) {
  return String(txt || '').replace(/\r/g, '').split('\n')
    .map(l => l.replace(/^\s*[-*•]\s*/, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
    .filter(l => l && !/^#|generated with|claude\.ai|^merge pull request|co-authored-by|claude-session|^https?:/i.test(l)).slice(0, 10);
}
function notesHtml(notes) {
  return notes.length ? `<div class="whatsnew">${notes.map(n => {
    const m = n.match(/^([^:]{3,40}):\s+(.+)$/);   // "Chromecast: transmite al TV" → título en negrita
    return `<div class="wn">${icon('check')}<span>${m ? `<b>${esc(m[1])}:</b> ${esc(m[2])}` : esc(n)}</span></div>`;
  }).join('')}</div>` : '';
}
function showUpdateSheet() {
  const u = S.update; if (!u) return;
  const notes = releaseNotes(u.notes);
  showSheet(`Nueva versión ${u.ver}`, `
    <div class="hint" style="margin:-4px 0 12px">Tienes la ${esc(appVersion())}${u.size ? ` · descarga de ${(u.size / 1048576).toFixed(1)} MB` : ''}. Se instala encima, sin perder tus cuentas ni tu lista.</div>
    ${notes.length ? `<div class="set-title" style="margin:0 0 8px">Qué trae esta actualización</div>${notesHtml(notes)}` : `<div class="hint">Mejoras y correcciones.</div>`}
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
  S.cfg.pendingNotes = { ver: u.ver, notes: u.notes }; saveCfg();   // para mostrarlas al abrir la versión nueva
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
