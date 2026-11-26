'use strict';
// JOX3 Verifier — Mi Lista y envío por Telegram.

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
function clearList(sure) {
  if (!S.myList.length) return;
  if (!sure) { askConfirm('Vaciar Mi lista', `Se quitan los ${S.myList.length} elementos de la lista.`, 'Vaciar', () => clearList(true)); return; }
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
