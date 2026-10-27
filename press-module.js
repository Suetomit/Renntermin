/**
 * Gurkensöhne Cup - Lätti Presse-Modul (läuft neben der index-Seite)
 * Rendert in <div id="pressModule">. Liest direkt aus Firebase (press/...),
 * schreibt NUR über den Cloudflare-Worker (PIN-geprüft, Tageslimits).
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, onValue, query, limitToLast } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// >>> HIER nach dem Worker-Deploy die eigene Worker-URL eintragen (ohne / am Ende) <<<
const WORKER_URL = 'https://DEIN-WORKER.DEIN-NAME.workers.dev';

let DRIVERS = ['Timo', 'Pascale', 'Niklas', 'Tim', 'Marcel', 'Yannis', 'Eric', 'Philipp', 'Vivien', 'Cedric'];
const TONE_ICON = { hitzig: '🔥', cool: '😎', boese: '😈', nett: '😊' };
const SRC_ICON = { interview: '🎙️', story: '✍️', chat: '💬' };
const SRC_LABEL = { interview: '🎙️ Interview', story: '✍️ Fahrer-Story', chat: '💬 Chat-Zitat' };
const TONE_NAME = { hitzig: 'hitzig', cool: 'cool', boese: 'böse', nett: 'nett' };

const root = document.getElementById('pressModule');
if (root) init();

function init() {
  const app = initializeApp({
    apiKey: 'AIzaSyDDfD7PAl2RoeeSvzp6KnLHw1-ojEeYLaA',
    authDomain: 'gurkensohne-cup.firebaseapp.com',
    databaseURL: 'https://gurkensohne-cup-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'gurkensohne-cup',
    appId: '1:395947948221:web:8b201ab21470678caa9fd4',
  }, 'press');
  const db = getDatabase(app);

  const S = { tab: 'news', login: null, news: [], questions: {}, profiles: {}, chat: [], pending: '', msg: '', info: '' };
  const drafts = {};
  try { S.login = JSON.parse(localStorage.getItem('pressLogin') || 'null'); } catch (e) { S.login = null; }

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtTs = ts => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const topTone = t => Object.entries(t || {}).sort((a, b) => b[1] - a[1])[0]?.[0];

  // ---------- Firebase-Listener ----------
  onValue(query(ref(db, 'press/news'), limitToLast(20)), s => {
    S.news = Object.entries(s.val() || {}).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.ts - a.ts);
    // Neueste Presse-News an die Breaking-News-Leiste der Hauptseite übergeben (siehe index: generateNewsTicker)
    window.pressNewsTicker = S.news.slice(0, 6).map(n => `${SRC_ICON[n.source] || '📰'} ${esc(n.title)}`);
    window.dispatchEvent(new Event('pressNewsUpdated'));
    render();
  });
  onValue(ref(db, 'driverRoster'), s => {
    const r = s.val(), list = r ? (Array.isArray(r) ? r : Object.values(r)) : [];
    const names = list.filter(d => d && d.human).map(d => d.human);
  if (names.length) DRIVERS = names;
    render();
  });
  onValue(ref(db, 'press/questions'), s => { S.questions = s.val() || {}; render(); });
  onValue(ref(db, 'press/profiles'), s => { S.profiles = s.val() || {}; render(); });

  let chatUnsub = null;
  function watchChat() {
    if (chatUnsub) { chatUnsub(); chatUnsub = null; }
    S.chat = [];
    if (!S.login) return;
    chatUnsub = onValue(query(ref(db, `press/chats/${S.login.name}`), limitToLast(30)), s => {
      S.chat = Object.values(s.val() || {}).sort((a, b) => a.ts - b.ts);
      render();
    });
  }
  watchChat();

  // ---------- Worker-Aufruf ----------
  async function api(route, payload) {
    S.msg = ''; S.info = ''; S.pending = route; render();
    try {
      const r = await fetch(`${WORKER_URL}/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: S.login.name, pin: S.login.pin, ...payload }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`);
      return j;
    } catch (e) {
      S.msg = e.message === 'Failed to fetch' ? 'Worker nicht erreichbar - ist die WORKER_URL in press-module.js gesetzt?' : e.message;
      return null;
    } finally { S.pending = ''; render(); }
  }

  // ---------- Views ----------
  const loginHtml = () => S.login
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:0.8rem;color:var(--m);">
         <span>Angemeldet als <strong style="color:var(--y);">${esc(S.login.name)}</strong></span>
         <button class="btn-rm" data-act="logout">abmelden</button></div>`
    : `<div style="margin-bottom:12px;">
         <select id="pressName" class="pin-input">${DRIVERS.map(n => `<option ${drafts.pressName === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
         <input id="pressPin" type="password" class="pin-input" placeholder="Dein persönlicher PIN" value="${esc(drafts.pressPin || '')}">
         <button class="btn" data-act="login">Anmelden</button></div>`;

  const newsHtml = () => !S.news.length
    ? '<div style="color:var(--m);font-size:0.85rem;">Noch keine News. Schreib eine Story oder beantworte eine Frage von Lätti!</div>'
    : S.news.map(n => `<div class="slot-card" style="border-left:3px solid ${n.source === 'interview' ? '#b15eff' : n.source === 'chat' ? '#27f4d2' : 'var(--y)'};">
        <div style="font-size:0.68rem;color:var(--m);margin-bottom:3px;">${SRC_LABEL[n.source] || '📰 News'} · ${esc(n.driver || n.author)} · ${fmtTs(n.ts)}</div>
        <div style="font-weight:800;margin-bottom:4px;">${esc(n.title)}</div>
        <div style="font-size:0.85rem;line-height:1.4;">${esc(n.text)}</div></div>`).join('');

  const toneChip = t => { const k = topTone(t); return k ? `<span style="font-size:0.72rem;background:var(--bg);padding:2px 8px;border-radius:10px;">${TONE_ICON[k]} ${TONE_NAME[k]}</span>` : ''; };

  function fragenHtml() {
    const all = Object.entries(S.questions).map(([id, q]) => ({ id, ...q }));
    const mine = S.login ? all.filter(q => q.driver === S.login.name && q.status === 'offen') : [];
    const done = all.filter(q => S.login && q.driver === S.login.name && q.status === 'beantwortet').sort((a, b) => b.answeredTs - a.answeredTs).slice(0, 12);
    let h = loginHtml();
    if (S.login) {
      h += mine.length ? mine.map(q => `<div class="slot-card" style="border-left:3px solid #27f4d2;">
          <div style="font-size:0.7rem;color:#27f4d2;font-weight:800;">🎙️ LÄTTI FRAGT</div>
          <div style="font-weight:700;margin:4px 0 8px;">${esc(q.question)}</div>
          <textarea id="ans_${q.id}" class="pin-input" rows="3" maxlength="800" placeholder="Deine Antwort ...">${esc(drafts['ans_' + q.id] || '')}</textarea>
          <button class="btn" style="margin-top:0;" data-act="answer" data-id="${q.id}" ${S.pending ? 'disabled' : ''}>${S.pending === 'answer' ? 'Lätti wertet aus ...' : 'Antwort abschicken'}</button></div>`).join('')
        : '<div style="color:var(--m);font-size:0.85rem;margin-bottom:10px;">Keine offene Frage für dich - Lätti meldet sich nach dem nächsten Rennen.</div>';
    }
    if (!S.login) return h + '<div style="color:var(--m);font-size:0.85rem;">Melde dich an, um deine Fragen und Antworten zu sehen. Die Interviews aller Fahrer erscheinen als News.</div>';
    h += `<div style="font-weight:700;margin:12px 0 6px;">📋 Deine bisherigen Antworten</div>`;
    h += done.length ? done.map(q => `<div class="slot-card">
        <div style="font-size:0.7rem;color:var(--m);">${esc(q.driver)} · ${fmtTs(q.answeredTs)} ${toneChip(q.tone)}</div>
        <div style="font-weight:700;margin:3px 0;">„${esc(q.question)}“</div>
        <div style="font-size:0.85rem;">${esc(q.answer)}</div></div>`).join('') : '<div style="color:var(--m);font-size:0.85rem;">Du hast noch keine Frage beantwortet.</div>';
    return h;
  }

  const storyHtml = () => loginHtml() + (S.login ? `
    <div style="font-size:0.8rem;color:var(--m);margin-bottom:8px;">Erzähl Lätti, was passiert ist (Zweikampf, Setup-Geheimnis, Funkspruch ...). Sie macht daraus einen News-Artikel.</div>
    <textarea id="storyText" class="pin-input" rows="5" maxlength="1200" placeholder="Deine Story ...">${esc(drafts.storyText || '')}</textarea>
    <button class="btn" data-act="story" ${S.pending ? 'disabled' : ''}>${S.pending === 'story' ? 'Lätti schreibt ...' : 'Story an die Presse schicken'}</button>` : '');

  const chatHtml = () => loginHtml() + (S.login ? `
    <div style="font-size:0.72rem;color:var(--m);margin-bottom:8px;">💡 Lätti kann interessante Aussagen aus dem Chat als News veröffentlichen. Schreib <strong>privat:</strong> an den Anfang einer Nachricht, dann bleibt sie unter euch.</div>
    <div id="pressChatBox" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
      ${S.chat.length ? S.chat.map(m => `<div style="align-self:${m.role === 'user' ? 'flex-end' : 'flex-start'};max-width:85%;background:${m.role === 'user' ? 'rgba(255,215,0,0.12)' : 'var(--s3)'};padding:7px 10px;border-radius:10px;font-size:0.85rem;">
          ${m.role === 'user' ? '' : '<div style="font-size:0.65rem;color:#27f4d2;font-weight:800;">LÄTTI</div>'}${esc(m.text)}</div>`).join('')
        : '<div style="color:var(--m);font-size:0.85rem;">Sag Hallo zu Lätti! (Sie ist eine KI-Figur.)</div>'}
      ${S.pending === 'chat' ? '<div style="font-size:0.8rem;color:var(--m);font-style:italic;">Lätti tippt ...</div>' : ''}
    </div>
    <div style="display:flex;gap:8px;">
      <input id="chatIn" class="pin-input" style="margin-bottom:0;" maxlength="500" placeholder="Nachricht an Lätti ..." value="${esc(drafts.chatIn || '')}">
      <button class="btn" style="margin-top:0;width:auto;" data-act="chat" ${S.pending ? 'disabled' : ''}>Senden</button>
    </div>` : '');

  const TRAITS = {
    ehrgeiz: ['🏆', 'Ehrgeiz'], selbstbewusst: ['😏', 'Selbstbewusstsein'], angriff: ['⚔️', 'Angriffslust'], humor: ['😂', 'Humor'],
    teamgeist: ['🤝', 'Teamgeist'], selbstkritik: ['🪞', 'Selbstkritik'], analytisch: ['🧠', 'Analytik'], emotional: ['🔥', 'Leidenschaft'],
  };

  function profileHtml() {
    const list = Object.entries(S.profiles);
    if (!list.length) return '<div style="color:var(--m);font-size:0.85rem;">Profile entstehen automatisch aus Interviews und Chats mit Lätti.</div>';
    return list.map(([name, p]) => {
      const sc = p.scores;
      return `<div class="slot-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><strong>${esc(name)}</strong><span style="color:var(--y);font-size:0.8rem;font-weight:700;">${esc(p.label || '-')}</span></div>
        ${p.steckbrief ? `<div style="font-size:0.78rem;font-style:italic;color:var(--m);margin:4px 0 6px;">„${esc(p.steckbrief)}“ - Lätti</div>` : ''}
        ${sc ? Object.entries(TRAITS).map(([k, [icon, label]]) => {
          const v = Math.round((sc[k] || 0) * 100);
          return `<div style="display:flex;align-items:center;gap:8px;margin-top:5px;font-size:0.75rem;">
            <span style="width:128px;white-space:nowrap;">${icon} ${label}</span>
            <div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden;"><div style="width:${v}%;height:100%;background:var(--y);"></div></div>
            <span style="width:32px;text-align:right;">${v}%</span></div>`;
        }).join('') : '<div style="font-size:0.75rem;color:var(--m);margin-top:6px;">Das Charakterprofil wird bei der nächsten Antwort oder nach 4 Chat-Nachrichten neu erstellt.</div>'}
        <div style="margin-top:6px;font-size:0.75rem;color:var(--m);">${(p.traits || []).map(esc).join(' · ')} ${p.count ? `· ${p.count} Auswertung(en)` : ''}</div></div>`;
    }).join('') + '<div style="font-size:0.68rem;color:var(--m2);margin-top:6px;">Spaß-Profile, automatisch von einer KI geschätzt - nicht ernst nehmen.</div>';
  }

  function render() {
    // Fokus + Cursorposition merken, damit Firebase-Updates das Tippen nicht unterbrechen
    const ae = document.activeElement;
    const focus = ae && root.contains(ae) && ae.id ? { id: ae.id, start: ae.selectionStart, end: ae.selectionEnd } : null;
    const tabs = [['news', '📰 News'], ['fragen', '❓ Fragen'], ['story', '✍️ Story'], ['chat', '💬 Lätti'], ['profile', '🧬 Profile']];
    const openMine = S.login ? Object.values(S.questions).filter(q => q.driver === S.login.name && q.status === 'offen').length : 0;
    const body = { news: newsHtml, fragen: fragenHtml, story: storyHtml, chat: chatHtml, profile: profileHtml }[S.tab]();
    root.innerHTML = `<div class="card-title"><span>🎙️ Lätti - Presse</span></div>
      <div class="tabs" style="margin-bottom:12px;flex-wrap:wrap;">${tabs.map(([k, l]) =>
        `<button class="tab-btn ${S.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">${l}${k === 'fragen' && openMine ? ` (${openMine})` : ''}</button>`).join('')}</div>
      ${S.msg ? `<div style="color:#ff5555;font-size:0.8rem;margin-bottom:8px;">${esc(S.msg)}</div>` : ''}${S.info ? `<div style="color:#27f4d2;font-size:0.8rem;margin-bottom:8px;">${esc(S.info)}</div>` : ''}${body}`;
    const box = document.getElementById('pressChatBox');
    if (box) box.scrollTop = box.scrollHeight;
    if (focus) {
      const el = document.getElementById(focus.id);
      if (el) { el.focus(); try { el.setSelectionRange(focus.start, focus.end); } catch (e) { /* z.B. <select> */ } }
    }
  }

  // ---------- Events ----------
  root.addEventListener('input', e => { if (e.target.id) drafts[e.target.id] = e.target.value; });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'chatIn') { e.preventDefault(); act('chat'); } });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (t) act(t.dataset.act, t.dataset);
  });

  async function act(a, data = {}) {
    if (a === 'tab') { S.tab = data.tab; S.msg = ''; return render(); }
    if (a === 'logout') { S.login = null; localStorage.removeItem('pressLogin'); watchChat(); return render(); }
    if (a === 'login') {
      const name = document.getElementById('pressName')?.value, pin = (document.getElementById('pressPin')?.value || '').trim();
      if (!name || !pin) { S.msg = 'Bitte Namen und PIN angeben.'; return render(); }
      S.login = { name, pin }; localStorage.setItem('pressLogin', JSON.stringify(S.login)); drafts.pressPin = ''; watchChat();
      return render();
    }
    if (!S.login || S.pending) return;
    if (a === 'chat') {
      const message = (drafts.chatIn || '').trim(); if (!message) return;
      drafts.chatIn = '';
      const j = await api('chat', { message });
      if (!j) drafts.chatIn = message;
      else if (j.news) { S.info = `📰 Lätti hat daraus eine News gemacht: „${j.news}“`; render(); }
    } else if (a === 'story') {
      const text = (drafts.storyText || '').trim();
      const j = await api('story', { text });
      if (j) { drafts.storyText = ''; S.tab = 'news'; render(); }
    } else if (a === 'answer') {
      const key = 'ans_' + data.id, answer = (drafts[key] || '').trim();
      const j = await api('answer', { questionId: data.id, answer });
      if (j) { delete drafts[key]; render(); }
    }
    // Bei falschem PIN abmelden, damit nicht mit falschen Daten weitergemacht wird
    if (/PIN falsch/.test(S.msg)) { S.login = null; localStorage.removeItem('pressLogin'); watchChat(); render(); }
  }

  render();
}
