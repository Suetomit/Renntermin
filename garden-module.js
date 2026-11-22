/**
 * Gurkensöhne Cup - Gurkengarten (läuft neben der index-Seite)
 * Rendert in <div id="gardenModule">. Liest direkt aus Firebase (press/garden, press/daily),
 * schreibt NUR über den Cloudflare-Worker (PIN-geprüft): Routen /claim und /quiz.
 * Der Login wird mit dem Presse-Modul geteilt (localStorage "pressLogin").
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const WORKER_URL = 'https://laetti-press.der-alles-schecker.workers.dev';

const STAGES = [['🌱', 'Keimling'], ['🌿', 'Spross'], ['🌼', 'Blüte'], ['🥒', 'Gurke'], ['🥒✨', 'Prachtgurke']];
const STAGE_FROM = [0, 2, 4, 7, 14];
const stageOf = s => STAGE_FROM.filter(t => s >= t).length - 1;
const payFor = (stage, first) => (first ? 20 + 10 * stage : 10 + 5 * stage);

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const hourNow = () => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).format(new Date()), 10);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
const nextStreak = (g, date) => {
  if (!g.lastDay) return 1;
  const gap = dayDiff(date, g.lastDay), s = g.streak || 0;
  return gap === 1 ? s + 1 : gap > 1 ? (s >> Math.min(gap - 1, 10)) + 1 : s;
};
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readLogin = () => { try { return JSON.parse(localStorage.getItem('pressLogin') || 'null'); } catch (e) { return null; } };
const seenGossip = () => { try { return localStorage.getItem('gardenGossipSeen'); } catch (e) { return null; } };

const root = document.getElementById('gardenModule');
if (root) init();

function init() {
  const app = initializeApp({
    apiKey: 'AIzaSyDDfD7PAl2RoeeSvzp6KnLHw1-ojEeYLaA',
    authDomain: 'gurkensohne-cup.firebaseapp.com',
    databaseURL: 'https://gurkensohne-cup-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'gurkensohne-cup',
    appId: '1:395947948221:web:8b201ab21470678caa9fd4',
  }, 'garden');
  const db = getDatabase(app);

  let DRIVERS = ['Timo', 'Pascale', 'Niklas', 'Tim', 'Marcel', 'Yannis', 'Eric', 'Philipp', 'Vivien', 'Cedric'];
  const S = { tab: 'garden', login: readLogin(), garden: {}, daily: null, pending: '', msg: '', info: '' };
  const drafts = {};
  let dailyDate = today(), dailyUnsub = null, dailyLoaded = false, quizInit = '';

  // ---------- Firebase ----------
  onValue(ref(db, 'press/garden'), s => { S.garden = s.val() || {}; render(); });
  onValue(ref(db, 'driverRoster'), s => {
    const r = s.val(), list = r ? (Array.isArray(r) ? r : Object.values(r)) : [];
    const names = list.filter(d => d && d.human).map(d => d.human);
    if (names.length) DRIVERS = names;
    render();
  });
  function watchDaily() {
    if (dailyUnsub) dailyUnsub();
    dailyDate = today();
    dailyLoaded = false;
    dailyUnsub = onValue(ref(db, `press/daily/${dailyDate}`), s => { S.daily = s.val(); dailyLoaded = true; render(); });
  }
  watchDaily();
  // Tageswechsel bei offener Seite und Login-Wechsel im Presse-Modul bemerken
  setInterval(() => {
    if (today() !== dailyDate) { S.msg = ''; S.info = ''; watchDaily(); render(); }
    const l = readLogin();
    if (JSON.stringify(l) !== JSON.stringify(S.login)) { S.login = l; render(); }
  }, 5000);

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
      S.msg = e.message === 'Failed to fetch' ? 'Der Server ist gerade nicht erreichbar. Versuch es gleich nochmal.' : e.message;
      return null;
    } finally { S.pending = ''; render(); }
  }

  // ---------- Zustand des eigenen Gartens ----------
  function me() {
    const g = (S.login && S.garden[S.login.name]) || {};
    const date = today(), slot = hourNow() < 16 ? 'am' : 'pm';
    const t = g.today && g.today.date === date ? g.today : {};
    const first = !t.am && !t.pm;
    const streak = g.streak || 0, nStreak = first ? nextStreak(g, date) : streak;
    const missed = g.lastDay ? dayDiff(date, g.lastDay) - 1 : 0;
    const qz = g.quiz && g.quiz.date === date ? (g.quiz.r || {}) : {};
    return { g, date, slot, t, first, streak, missed, wilted: missed > 0 && first, nStreak, stage: stageOf(streak),
      gain: payFor(stageOf(nStreak), first), done: !!t[slot], quiz: qz, points: g.points || 0 };
  }

  // ---------- Views ----------
  const loginHtml = () => S.login
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:0.8rem;color:var(--m);">
         <span>Angemeldet als <strong style="color:var(--y);">${esc(S.login.name)}</strong></span>
         <button class="btn-rm" data-act="logout">abmelden</button></div>`
    : `<div style="margin-bottom:6px;">
         <div style="font-size:0.85rem;color:var(--m);margin-bottom:8px;">Melde dich an, um deine Gurke zu gießen und das Tagesrätsel zu lösen.</div>
         <select id="gardenName" class="pin-input" style="margin-bottom:8px;">${DRIVERS.map(n => `<option ${drafts.gardenName === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
         <input id="gardenPin" type="password" class="pin-input" style="margin-bottom:8px;" placeholder="Dein persönlicher PIN" value="${esc(drafts.gardenPin || '')}">
         <button class="btn" style="margin-top:0;" data-act="login">Anmelden</button></div>`;

  function gardenHtml() {
    if (!S.login) return loginHtml();
    const m = me(), [icon, name] = STAGES[m.stage];
    const nextAt = STAGE_FROM.find(t => t > m.streak);
    const hint = m.wilted
      ? `🥀 Deine Gurke ist leicht welk. Gießt du jetzt, schrumpft die Serie auf ${m.nStreak} Tage.`
      : nextAt !== undefined ? `Noch ${nextAt - m.streak} Tag${nextAt - m.streak === 1 ? '' : 'e'} bis zur Stufe „${STAGES[m.stage + 1][1]}“.` : 'Höchste Stufe erreicht, bring die Gurke weiter durch den Winter.';
    const label = m.done
      ? (m.slot === 'am' ? 'Morgenrunde gegossen, die Abendrunde startet um 16 Uhr' : 'Heute ist alles gegossen')
      : `${m.slot === 'am' ? '☀️ Morgenrunde' : '🌙 Abendrunde'} gießen (+${m.gain} Punkte)`;
    return loginHtml() + `
      <div class="slot-card" style="margin-top:0;text-align:center;">
        <div style="font-size:${46 + m.stage * 10}px;line-height:1.1;" aria-hidden="true">${icon}</div>
        <div style="font-weight:800;font-size:1.05rem;margin-top:4px;">${name}</div>
        <div style="font-size:0.8rem;color:var(--m);margin:2px 0 8px;">Serie: ${m.streak} Tag${m.streak === 1 ? '' : 'e'} · Rekord: ${m.g.best || 0}</div>
        <div style="font-size:0.8rem;">${hint}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 0;font-size:0.85rem;">
        <span>Heute: ${m.t.am ? '☀️✓' : '☀️–'} ${m.t.pm ? '🌙✓' : '🌙–'}</span>
        <span>🥒 <strong style="color:var(--y);">${m.points}</strong> Gurkenpunkte</span></div>
      <button class="btn" ${m.done || S.pending ? 'disabled' : ''} data-act="claim">${S.pending === 'claim' ? 'Gieße ...' : label}</button>
      <div style="font-size:0.72rem;color:var(--m);margin-top:8px;">Zweimal am Tag gießen bringt extra Punkte, und je länger die Serie, desto größer die Gurke. Jeder verpasste Tag halbiert die Serie. Bald kannst du die Punkte in Packs mit Sammelkarten stecken.</div>`;
  }

  function quizHtml() {
    if (!S.login) return loginHtml();
    const m = me(), qz = S.daily && S.daily.quiz, items = qz && qz.items ? Object.values(qz.items) : [];
    if (!items.length) return loginHtml() + '<div style="color:var(--m);font-size:0.85rem;">Das Tagesquiz wird gerade vorbereitet ...</div>';
    const answered = items.filter((_, i) => m.quiz['q' + i]).length, right = items.filter((_, i) => m.quiz['q' + i] && m.quiz['q' + i].ok).length;
    const head = answered === items.length
      ? `<div class="note gold">Heute ${right} von ${items.length} richtig${right === items.length ? ', Bonus kassiert! 🎉' : '.'} Morgen gibt es neue Fragen.</div>`
      : `<div style="font-size:0.8rem;color:var(--m);margin-bottom:4px;">${items.length} Fragen am Tag: 5 Punkte pro richtiger Antwort, 5 Bonuspunkte bei ${items.length} von ${items.length}. Pro Frage zählt nur eine Antwort.</div>`;
    return loginHtml() + head + items.map((it, i) => {
      const r = m.quiz['q' + i];
      return `<div class="slot-card" style="margin-top:8px;"><div style="font-weight:700;margin-bottom:6px;">${i + 1}. ${esc(it.q)}</div>` + (r
        ? `<div class="note ${r.ok ? 'gold' : ''}" style="margin-bottom:0;">${r.ok ? '✅ Richtig: ' : `❌ Du hattest „${esc(r.p)}“. Richtig ist: `}<b>${esc(r.right)}</b></div>`
        : (it.opts || []).map((o, k) => `<button class="btn ghost" style="margin-top:6px;text-align:left;" ${S.pending ? 'disabled' : ''} data-act="answer" data-i="${i}" data-o="${k}">${esc(o)}</button>`).join('')) + '</div>';
    }).join('');
  }

  function gossipHtml() {
    const g = S.daily && S.daily.gossip;
    const d = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<div style="font-size:0.75rem;color:var(--m);margin-bottom:8px;">Tagesklatsch von Lätti, ${esc(d)}</div>` + (g && g.items && g.items.length
      ? g.items.map(x => `<div class="note" style="margin-bottom:8px;">${esc(x)}</div>`).join('')
      : '<div style="color:var(--m);font-size:0.85rem;">Lätti hat heute noch nichts aufgeschnappt. Sobald die erste Gurke gegossen ist, gibt es Neuigkeiten aus dem Fahrerlager.</div>')
      + '<div style="font-size:0.68rem;color:var(--m2);margin-top:6px;">Von einer KI geschrieben und nicht ernst gemeint.</div>';
  }

  function ligaHtml() {
    const rows = DRIVERS.map(n => ({ n, g: S.garden[n] || {} }))
      .sort((a, b) => (b.g.streak || 0) - (a.g.streak || 0) || (b.g.points || 0) - (a.g.points || 0));
    return `<div style="font-size:0.75rem;color:var(--m);margin-bottom:6px;">So weit sind die Gurken der Liga:</div>` + rows.map(({ n, g }) => {
      const st = g.streak ? STAGES[stageOf(g.streak)] : ['🌰', 'noch nicht gepflanzt'];
      const you = S.login && S.login.name === n;
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:0.85rem;">
        <span style="font-size:1.4rem;width:36px;text-align:center;">${st[0]}</span>
        <span style="flex:1;min-width:0;"><strong style="${you ? 'color:var(--y);' : ''}">${esc(n)}</strong><div style="font-size:0.72rem;color:var(--m);">${st[1]}</div></span>
        <span style="text-align:right;"><strong>${g.streak || 0}</strong> <span style="font-size:0.72rem;color:var(--m);">Tage</span></span></div>`;
    }).join('');
  }

  function render() {
    const ae = document.activeElement;
    const focus = ae && root.contains(ae) && ae.id ? { id: ae.id, start: ae.selectionStart, end: ae.selectionEnd } : null;
    if (S.tab === 'gossip' && S.daily && S.daily.gossip) { try { localStorage.setItem('gardenGossipSeen', dailyDate); } catch (e) { /* egal */ } }
    const m = S.login ? me() : null;
    const dot = {
      garden: m && !m.done,
      quiz: m && !!(S.daily && S.daily.quiz) && Object.keys(m.quiz).length < Object.values(S.daily.quiz.items || {}).length,
      gossip: !!(S.daily && S.daily.gossip) && seenGossip() !== dailyDate && S.tab !== 'gossip',
    };
    const tabs = [['garden', '🥒 Garten'], ['quiz', '🧠 Quiz'], ['gossip', '🗞️ Klatsch'], ['liga', '👥 Liga']];
    const body = { garden: gardenHtml, quiz: quizHtml, gossip: gossipHtml, liga: ligaHtml }[S.tab]();
    root.innerHTML = `<div class="card-title"><span>🥒 Gurkengarten</span>${m ? `<span style="font-size:0.85rem;color:var(--y);">${m.points} Punkte</span>` : ''}</div>
      <div class="tabs" style="margin-bottom:12px;flex-wrap:nowrap;overflow-x:auto;">${tabs.map(([k, l]) =>
        `<button class="tab-btn ${S.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">${l}${dot[k] ? ' <span style="color:#e10600;" aria-label="neu">●</span>' : ''}</button>`).join('')}</div>
      ${S.msg ? `<div style="color:#ff5555;font-size:0.8rem;margin-bottom:8px;">${esc(S.msg)}</div>` : ''}${S.info ? `<div style="color:#27f4d2;font-size:0.8rem;margin-bottom:8px;">${esc(S.info)}</div>` : ''}${body}`;
    if (S.tab === 'quiz' && S.login && dailyLoaded && !(S.daily && S.daily.quiz) && quizInit !== dailyDate && !S.pending) { quizInit = dailyDate; setTimeout(() => api('quiz', {}), 0); }
    if (focus) {
      const el = document.getElementById(focus.id);
      if (el) { el.focus(); try { el.setSelectionRange(focus.start, focus.end); } catch (e) { /* z.B. <select> */ } }
    }
  }

  // ---------- Events ----------
  root.addEventListener('input', e => { if (e.target.id) drafts[e.target.id] = e.target.value; });
  root.addEventListener('change', e => { if (e.target.id) drafts[e.target.id] = e.target.value; });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (t) act(t.dataset.act, t.dataset);
  });

  async function act(a, data = {}) {
    if (a === 'tab') { S.tab = data.tab; S.msg = ''; S.info = ''; return render(); }
    if (a === 'logout') { S.login = null; localStorage.removeItem('pressLogin'); return render(); }
    if (a === 'login') {
      const name = document.getElementById('gardenName')?.value, pin = (document.getElementById('gardenPin')?.value || '').trim();
      if (!name || !pin) { S.msg = 'Bitte Namen und PIN angeben.'; return render(); }
      S.login = { name, pin }; localStorage.setItem('pressLogin', JSON.stringify(S.login)); drafts.gardenPin = '';
      return render();
    }
    if (!S.login || S.pending) return;
    if (a === 'claim') {
      const j = await api('claim', {});
      if (j) { S.info = `+${j.gain} Gurkenpunkte${j.first ? `, Serie: ${j.streak} Tag${j.streak === 1 ? '' : 'e'}` : ''}`; render(); }
    } else if (a === 'answer') {
      const it = S.daily && S.daily.quiz && Object.values(S.daily.quiz.items || {})[+data.i];
      if (!it || !it.opts) return;
      const j = await api('quiz', { index: +data.i, answer: it.opts[+data.o] });
      if (j) { S.info = j.correct ? `Richtig! +${j.gain} Gurkenpunkte${j.bonus ? ' (inklusive Bonus)' : ''}` : 'Leider falsch.'; render(); }
    }
    // Bei falschem PIN abmelden, damit nicht mit falschen Daten weitergemacht wird
    if (/PIN falsch/.test(S.msg)) { S.login = null; localStorage.removeItem('pressLogin'); render(); }
  }

  render();
}
