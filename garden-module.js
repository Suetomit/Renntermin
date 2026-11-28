/**
 * Gurkensöhne Cup - Gurkengarten (läuft neben der index-Seite)
 * Rendert in <div id="gardenModule">. Liest direkt aus Firebase (press/garden, press/daily),
 * schreibt NUR über den Cloudflare-Worker (PIN-geprüft): Routen /claim und /quiz.
 * Der Login wird mit dem Presse-Modul geteilt (localStorage "pressLogin").
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { createCasino } from './casino-ui.mjs';
import { createLotto } from './lotto-ui.mjs';

const WORKER_URL = 'https://laetti-press.der-alles-schecker.workers.dev';

const STAGES = [['🌱', 'Keimling'], ['🌿', 'Spross'], ['🌼', 'Blüte'], ['🥒', 'Gurke'], ['🥒✨', 'Prachtgurke']];
const STAGE_FROM = [0, 2, 4, 7, 14];
const stageOf = s => STAGE_FROM.filter(t => s >= t).length - 1;
const payFor = (stage, slot) => (slot === 'am' ? 20 + 10 * stage : 10 + 5 * stage);

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


// ---------- Sammelkarten: Konstanten und Stil ----------
const TC = { 'Ferrari': '#e8002d', 'McLaren': '#ff8000', 'Red Bull': '#3671c6', 'Mercedes-AMG Petronas': '#27f4d2', 'Aston Martin': '#358c75', 'Alpine': '#ff87bc', 'Williams': '#64c4ff', 'Visa Cash App RB': '#6692ff', 'Kick Sauber': '#52e252', 'Haas': '#b6babd' };
const HELM = { 'McLaren': 'mclaren', 'Mercedes-AMG Petronas': 'mercedes', 'Ferrari': 'ferrari', 'Red Bull': 'redbull', 'Aston Martin': 'astonmartin', 'Williams': 'williams', 'Alpine': 'alpine', 'Haas': 'haas', 'Visa Cash App RB': 'racingbulls', 'Kick Sauber': 'kicksauber' };
const TRACKS = ('AUS|au|Australien|Melbourne;CHN|cn|China|Shanghai;JPN|jp|Japan|Suzuka;BHR|bh|Bahrain|Sachir;SAU|sa|Saudi-Arabien|Dschidda;MIA|us|USA|Miami;IMO|it|Emilia-Romagna|Imola;MCO|mc|Monaco|Monte Carlo;ESP|es|Spanien|Barcelona;CAN|ca|Kanada|Montreal;AUT|at|Österreich|Spielberg;GBR|gb|Großbritannien|Silverstone;BEL|be|Belgien|Spa-Francorchamps;HUN|hu|Ungarn|Hungaroring;NLD|nl|Niederlande|Zandvoort;ITA|it|Italien|Monza;AZE|az|Aserbaidschan|Baku;SGP|sg|Singapur|Singapur;USA|us|USA|Austin;MEX|mx|Mexiko|Mexiko-Stadt;BRA|br|Brasilien|São Paulo;VGS|us|USA|Las Vegas;QAT|qa|Katar|Lusail;UAE|ae|Ver. Arab. Emirate|Abu Dhabi')
  .split(';').map(x => { const [code, cc, country, city] = x.split('|'); return { code, cc, country, city }; });
const TIER_NAME = { B: 'Bronze', S: 'Silber', G: 'Gold', X: 'Spezial', IB: 'Baby-Icon', IN: 'Icon', IP: 'Prime-Icon' };
const PR_LABELS = [['str', 'STR', 'Strategie'], ['dev', 'ENT', 'Entwicklung'], ['lea', 'FÜH', 'Führung'], ['pit', 'BOX', 'Boxencrew'], ['nrv', 'NRV', 'Nerven']];
const STARS = { B: '★', S: '★★', G: '★★★' };
const STAT_LABELS = [['tmp', 'TMP', 'Tempo'], ['pac', 'PAC', 'Rennpace'], ['con', 'KON', 'Konstanz'], ['ang', 'ANG', 'Angriff'], ['rel', 'ZUV', 'Zuverlässigkeit']];
const PACK_NAME = { bronze: 'Bronze-Pack', silber: 'Silber-Pack', gold: 'Gold-Pack', spezial: 'Spezial-Pack' };
const PACK_COLOR = { bronze: 'linear-gradient(135deg,#d89a63,#8a5330)', silber: 'linear-gradient(135deg,#eef1f5,#98a2b0)', gold: 'linear-gradient(135deg,#ffe58a,#c7961c)', spezial: 'linear-gradient(135deg,#27f4d2,#8a5cff 55%,#ff5fd0)' };
const safe = k => String(k).replace(/[.#$\[\]\/]/g, '_');
const fmtLap = sec => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(3).padStart(6, '0')}`;
const pAt = (P, tier) => 1 - (1 - P.p.slice(['B', 'S', 'G', 'X'].indexOf(tier)).reduce((a, b) => a + b, 0)) ** P.n;
const pct = x => (x < 0.1 ? (x * 100).toFixed(1) : String(Math.round(x * 100))).replace('.', ',') + ' %';

if (!document.getElementById('gc-style')) {
  const st = document.createElement('style'); st.id = 'gc-style';
  st.textContent = `
.gc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.gc-wrap{container-type:inline-size;position:relative;cursor:pointer}
.gc{position:relative;aspect-ratio:5/7;border-radius:9% / 6.5%;padding:6cqw 6cqw 5cqw 8cqw;display:flex;flex-direction:column;font-size:11px;font-size:7.4cqw;color:#1a1400;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.5);user-select:none;box-sizing:border-box}
.gc-B{background:linear-gradient(160deg,#d89a63,#8a5330)}
.gc-S{background:linear-gradient(160deg,#eef1f5,#98a2b0)}
.gc-G{background:linear-gradient(160deg,#ffe58a,#c7961c)}
.gc-X{background:linear-gradient(135deg,#27f4d2,#8a5cff 55%,#ff5fd0);color:#0b0620}
.gc-IB{background:linear-gradient(160deg,#cfe9ff,#7fa8d6)}
.gc-IN{background:linear-gradient(160deg,#ffd9f0,#c9709e)}
.gc-IP{background:linear-gradient(135deg,#111,#3a2a00 40%,#ffd23f 75%,#fff6c2);color:#fff}
.gc-IP .gc-stats{border-color:rgba(255,255,255,.4)}
.gc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:4%}
.gc-ges{font:800 3em var(--hd);line-height:.9}
.gc-kind{font-size:.62em;font-weight:800;letter-spacing:.04em;text-align:right;opacity:.8;max-width:62%;line-height:1.1}
.gc-art{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;margin:3% 0}
.gc-art img{max-width:100%;max-height:100%;object-fit:contain}
.gc-emoji{font-size:3.2em}
.gc-name{font-weight:800;font-size:1.1em;text-align:center;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gc-sub{font-size:.66em;text-align:center;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3%}
.gc-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1%;font-size:.58em;text-align:center;font-weight:700;border-top:1px solid rgba(0,0,0,.25);padding-top:3%}
.gc-stats b{display:block;font-size:1.55em;font-family:var(--hd)}
.gc-bar{position:absolute;left:0;top:0;bottom:0;width:3.5%}
.gc-locked{filter:grayscale(1) brightness(.32)}
.gc-lockq{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 4em var(--hd);color:rgba(255,255,255,.55)}
.gc-cnt,.gc-new{position:absolute;top:4px;z-index:2;border-radius:10px;padding:1px 6px;font:800 11px var(--bd)}
.gc-cnt{right:4px;background:#e10600;color:#fff}
.gc-new{left:4px;background:#ffd23f;color:#1a1400}
.gc-flip{container-type:inline-size;perspective:900px;cursor:pointer}
.gc-flip-in{position:relative;aspect-ratio:5/7;transform-style:preserve-3d;transition:transform .7s}
.gc-flip.open .gc-flip-in{transform:rotateY(180deg)}
.gc-cover,.gc-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.gc-face{transform:rotateY(180deg)}
.gc-cover{border-radius:9% / 6.5%;background:linear-gradient(160deg,#1f3a2b,#0e1a14);border:2px solid #ffd23f;display:flex;align-items:center;justify-content:center;flex-direction:column;font-size:36px;font-size:16cqw;color:#ffd23f;font-weight:800;text-align:center}
.gc-cover small{font-size:.28em;letter-spacing:.08em;margin-top:6%}
.gc-flip.open.t-G .gc{box-shadow:0 0 22px 6px rgba(255,210,63,.75)}
.gc-flip.open.t-X .gc{box-shadow:0 0 26px 8px rgba(138,92,255,.85)}
#gardenOverlay{position:fixed;inset:0;z-index:60;background:rgba(5,10,8,.95);display:none;overflow:auto;padding:16px}
#gardenOverlay.on{display:block}
.gc-pack{border-radius:12px;padding:12px;margin-bottom:10px;color:#1a1400;display:flex;gap:12px;align-items:center}
.gc-pack.x{color:#0b0620}
.gc-bars div{display:flex;align-items:center;gap:8px;font-size:.78rem;margin-top:5px}
.gc-bars i{flex:1;height:6px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden}
.gc-bars i u{display:block;height:100%;background:var(--y)}`;
  document.head.appendChild(st);
}

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
  const S = { tab: 'garden', login: readLogin(), garden: {}, daily: null, pending: '', msg: '', info: '', defs: null, roster: [], cal: [], TR: {}, cardsTab: 'shop', album: { kind: 'driver', rarity: 'all', season: null } };
  const drafts = {};
  const casino = createCasino({ S, api: (r, p) => api(r, p), render: () => render(), esc, db, ref, onValue });
  const lotto = createLotto({ S, api: (r, p) => api(r, p), apiQuiet: (r, p) => apiQuiet(r, p), render: () => render(), esc });
  let dailyDate = today(), dailyUnsub = null, dailyLoaded = false, quizInit = '', defsLoaded = false, defsInit = '';

  // ---------- Firebase ----------
  onValue(ref(db, 'press/garden'), s => { S.garden = s.val() || {}; render(); });
  onValue(ref(db, 'driverRoster'), s => {
    const r = s.val(), list = r ? (Array.isArray(r) ? r : Object.values(r)) : [];
    const names = list.filter(d => d && d.human).map(d => d.human);
    if (names.length) DRIVERS = names;
    S.roster = list.filter(d => d && d.name);
    render();
  });
  onValue(ref(db, 'press/cardDefs'), s => { S.defs = s.val(); defsLoaded = true; render(); });
  onValue(ref(db, 'raceCalendarCodes'), s => { const r = s.val(); S.cal = r ? (Array.isArray(r) ? r : Object.values(r)).filter(Boolean) : []; render(); });
  onValue(ref(db, 'trackRecords'), s => { S.TR = s.val() || {}; render(); });
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

  // Stiller Worker-Aufruf für Hintergrund-Abfragen (Lotto-Status): ändert weder Meldungen noch "pending", kein Flackern
  async function apiQuiet(route, payload) {
    if (!S.login) return null;
    try {
      const r = await fetch(`${WORKER_URL}/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: S.login.name, pin: S.login.pin, ...payload }),
      });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
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
      gain: payFor(stageOf(nStreak), slot), done: !!t[slot], quiz: qz, points: g.points || 0 };
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
      cards: m && m.points >= (defsOk() ? Math.min(...Object.values(S.defs.config.packs).map(x => x.price)) : 100) && S.tab !== 'cards',
    };
    const tabs = [['garden', '🥒 Garten'], ['quiz', '🧠 Quiz'], ['gossip', '🗞️ Klatsch'], ['cards', '🃏 Karten'], ['casino', '🎰 Casino'], ['lotto', '🎟️ Lotto'], ['liga', '👥 Liga']];
    const body = { garden: gardenHtml, quiz: quizHtml, gossip: gossipHtml, cards: cardsHtml, casino: casino.html, lotto: lotto.html, liga: ligaHtml }[S.tab]();
    root.innerHTML = `<div class="card-title"><span>🥒 Gurkengarten</span>${m ? `<span style="font-size:0.85rem;color:var(--y);">${m.points} Punkte</span>` : ''}</div>
      <div class="tabs" style="margin-bottom:12px;flex-wrap:nowrap;overflow-x:auto;">${tabs.map(([k, l]) =>
        `<button class="tab-btn ${S.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">${l}${dot[k] ? ' <span style="color:#e10600;" aria-label="neu">●</span>' : ''}</button>`).join('')}</div>
      ${S.msg ? `<div style="color:#ff5555;font-size:0.8rem;margin-bottom:8px;">${esc(S.msg)}</div>` : ''}${S.info ? `<div style="color:#27f4d2;font-size:0.8rem;margin-bottom:8px;">${esc(S.info)}</div>` : ''}${body}`;
    if (S.tab === 'quiz' && S.login && dailyLoaded && !(S.daily && S.daily.quiz) && quizInit !== dailyDate && !S.pending) { quizInit = dailyDate; setTimeout(() => api('quiz', {}), 0); }
    if (S.tab === 'cards' && S.login && defsLoaded && defsInit !== dailyDate && !S.pending) { defsInit = dailyDate; setTimeout(() => api('buy', { prepare: true }), 0); }
    if (focus) {
      const el = document.getElementById(focus.id);
      if (el) { el.focus(); try { el.setSelectionRange(focus.start, focus.end); } catch (e) { /* z.B. <select> */ } }
    }
  }

  // ---------- Sammelkarten ----------
  const CARD_VER = 3;
  const ov = document.createElement('div'); ov.id = 'gardenOverlay'; document.body.appendChild(ov);
  const invOf = g => (g && g.cardVer === CARD_VER ? g.inv || {} : {});          // Karten der alten Version zählen nicht mehr (werden erstattet)
  const defsOk = () => !!(S.defs && S.defs.version === CARD_VER && S.defs.cards && S.defs.config);
  const prepMsg = () => `<div style="color:var(--m);font-size:0.85rem;">${defsInit === dailyDate && !S.pending ? 'Die Karten konnten nicht vorbereitet werden. Ist der aktuelle press-worker.js in Cloudflare deployt? Falls ja, versuch es gleich nochmal.' : 'Die Karten werden gerade vorbereitet ...'}</div>`;
  const curSeason = () => (S.defs && S.defs.season) || 1;
  const cardsMap = () => (S.defs && S.defs.cards) || {};
  const infoOf = key => (key.startsWith('special:') ? ((S.defs && S.defs.specials) || {})[key.slice(8)] : cardsMap()[key]);
  const seasonsList = () => [...new Set(Object.values(cardsMap()).map(c => c.season))].sort((a, b) => a - b);
  const helmetOf = team => (HELM[team] ? `helmet_${HELM[team]}.png` : '');
  const imgOr = (src, emoji) => (src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : `<span class="gc-emoji">${emoji}</span>`);
  const activeSpecials = () => {
    const sp = Object.values((S.defs && S.defs.specials) || {}).filter(x => x.season === curSeason()), maxR = Math.max(0, ...sp.map(x => x.race));
    return sp.filter(x => x.race >= maxR - 2).sort((a, b) => b.race - a.race || b.ges - a.ges);
  };
  const poolKeys = (kind, rarity, season) => {
    if (kind === 'special') return Object.values((S.defs && S.defs.specials) || {}).filter(x => x.season === season).sort((a, b) => b.race - a.race || b.ges - a.ges).map(x => 'special:' + x.id);
    return Object.values(cardsMap()).filter(c => (c.season === season || c.season === 0) && c.kind === kind && (rarity === 'all' || c.rarity === rarity)).sort((a, b) => b.ges - a.ges).map(c => c.key);
  };

  function resolveCard(key) {
    const c = infoOf(key);
    if (!c) return { tier: 'B', kind: 'KARTE', big: '?', name: 'Unbekannt', sub: '', art: '', extra: '' };
    const stats = o => STAT_LABELS.map(([k, l, f]) => [l, o[k], f]);
    if (c.kind === 'driver') {
      const rd = (S.roster || []).find(x => (c.rosterName && x.name === c.rosterName) || x.name === c.name || (x.human && x.human === c.short));
      const team = (rd && rd.team) || c.team || '';
      const photo = (rd && rd.photo) || c.photo || helmetOf(team);
      const labelName = (rd && rd.human) || c.short;
      return { tier: c.rarity, kind: 'FAHRER', big: c.ges, name: labelName, sub: team + (c.human ? '' : ' · KI'), color: TC[team], art: imgOr(photo, '🏎️'), stats: stats(c.stats), badges: c.badges };
    }
    if (c.kind === 'team') {
      const ds = S.roster.filter(d => d.team === c.name);
      return { tier: c.rarity, kind: 'TEAM', big: c.ges, name: c.name, sub: ds.map(d => d.human || String(d.name).split(' ').pop()).slice(0, 2).join(' & '), color: TC[c.name], art: imgOr(helmetOf(c.name), '🏁'), extra: `${ds.length} Fahrer in der Liga` };
    }
    if (c.kind === 'track') {
      const t = TRACKS.find(x => x.code === c.code) || { cc: 'un' }, rec = S.TR[c.code];
      return { tier: c.rarity, kind: 'STRECKE', big: c.ges, name: c.name, sub: c.country, art: `<img src="https://flagcdn.com/w160/${t.cc}.png" alt="" style="border-radius:6%;max-height:62%" onerror="this.remove()">`, extra: rec ? `Rekord ${fmtLap(rec.time)} · ${rec.driver}` : 'noch kein Rekord' };
    }
    if (c.kind === 'principal') return { tier: c.rarity, kind: 'TEAMCHEF', big: c.ges, name: c.short, sub: c.team || 'Legende', color: TC[c.team], art: imgOr(c.photo, '🧑‍💼'), stats: PR_LABELS.map(([k, l, f]) => [l, c.stats[k], f]), badges: c.badges };
    if (c.kind === 'icon') return { tier: c.rarity, kind: ({ baby: 'ICON · BABY', normal: 'ICON', prime: 'ICON · PRIME' })[c.stage], big: c.ges, name: c.short, sub: c.name, art: imgOr(c.photo, '⭐'), stats: stats(c.stats), badges: c.badges };
    return { tier: 'X', kind: c.title.toUpperCase(), big: c.ges, name: c.short, sub: c.team, color: TC[c.team], art: imgOr(c.photo || helmetOf(c.team), '🏎️'), stats: stats(c.stats), badges: c.reasons };
  }
  const cardBody = (key, locked) => {
    const c = resolveCard(key);
    return `<div class="gc gc-${c.tier}${locked ? ' gc-locked' : ''}">${c.color ? `<div class="gc-bar" style="background:${c.color}"></div>` : ''}
      <div class="gc-top"><div class="gc-ges">${esc(c.big)}</div><div class="gc-kind">${esc(c.kind)}</div></div>
      <div class="gc-art">${c.art}</div><div class="gc-name">${esc(c.name)}</div><div class="gc-sub">${esc(c.sub)}</div>
      ${c.stats ? `<div class="gc-stats">${c.stats.map(([l, v]) => `<span>${l}<b>${v}</b></span>`).join('')}</div>` : `<div class="gc-sub" style="margin:2% 0 0">${esc(c.extra || '')}</div>`}
      ${locked ? '<div class="gc-lockq">?</div>' : ''}</div>`;
  };
  const cardHtml = (key, o = {}) => `<div class="gc-wrap">${cardBody(key, o.locked)}${o.count > 1 ? `<span class="gc-cnt">×${o.count}</span>` : ''}${o.isNew ? '<span class="gc-new">NEU</span>' : ''}</div>`;

  function openReveal(keys, isNew, allOpen) {
    ov.innerHTML = `<div style="max-width:560px;margin:0 auto;"><h2 style="text-align:center;">Pack geöffnet 🎉</h2>
      <div style="font-size:.8rem;color:var(--m);text-align:center;margin-bottom:12px;">Tippe die Karten an, um sie aufzudecken.</div>
      <div class="gc-grid">${keys.map((k, i) => `<div class="gc-wrap" style="position:relative"><div class="gc-flip t-${resolveCard(k).tier}${allOpen ? ' open' : ''}"><div class="gc-flip-in">
        <div class="gc-cover">🥒<small>GURKENSÖHNE CUP</small></div><div class="gc-face">${cardBody(k)}</div></div></div>${isNew && isNew[i] ? '<span class="gc-new">NEU</span>' : ''}</div>`).join('')}</div>
      <button class="btn ghost" data-act="revealall">Alle aufdecken</button><button class="btn" data-act="close">Fertig</button></div>`;
    ov.classList.add('on'); ov.scrollTop = 0;
  }
  function openDetail(key) {
    const m = me(), n = invOf(m.g)[key] || 0, c = resolveCard(key), info = infoOf(key) || {}, cfg = S.defs && S.defs.config;
    const qs = cfg ? cfg.quicksell[c.tier] : 0, range = cfg && cfg.ranges && cfg.ranges[c.tier] ? ` (${cfg.ranges[c.tier][0]} bis ${cfg.ranges[c.tier][1]} GES)` : '';
    ov.innerHTML = `<div style="max-width:320px;margin:10px auto 24px;">${cardHtml(key, { locked: !n, count: n })}
      <div style="text-align:center;margin-top:12px;font-size:.9rem;">${n ? `Du besitzt <b>${n}×</b>` : 'Noch nicht in deiner Sammlung'} · ${TIER_NAME[c.tier]}${esc(range)}${info.season ? ` · Saison ${info.season}` : ''}</div>
      ${c.badges && c.badges.length ? `<div style="text-align:center;margin-top:6px;">${c.badges.map(b => `<span class="chip" style="font-size:.72rem;">${esc(b)}</span>`).join(' ')}</div>` : ''}
      ${info.boost ? `<div style="text-align:center;font-size:.78rem;color:var(--m);margin-top:6px;">Inform-Karte: +${info.boost} auf alle Werte</div>` : ''}
      ${c.stats ? `<div class="gc-bars" style="margin-top:8px;">${c.stats.map(([l, v, f]) => `<div><span style="width:110px;">${f}</span><i><u style="width:${v}%"></u></i><b style="width:26px;text-align:right;">${v}</b></div>`).join('')}</div>` : ''}
      ${n > 1 ? `<button class="btn ghost" data-act="melt" data-key="${esc(key)}" data-all="0" ${S.pending ? 'disabled' : ''}>1 Duplikat einschmelzen (+${qs})</button>${n > 2 ? `<button class="btn ghost" data-act="melt" data-key="${esc(key)}" data-all="1" ${S.pending ? 'disabled' : ''}>Alle ${n - 1} Duplikate einschmelzen (+${qs * (n - 1)})</button>` : ''}` : ''}
      <button class="btn" data-act="close">Schließen</button></div>`;
    ov.classList.add('on'); ov.scrollTop = 0;
  }
  const closeOv = () => { ov.classList.remove('on'); ov.innerHTML = ''; };
  ov.addEventListener('click', e => {
    const f = e.target.closest('.gc-flip'); if (f) { f.classList.add('open'); return; }
    const t = e.target.closest('[data-act]'); if (t) act(t.dataset.act, t.dataset);
  });

  function shopHtml(m) {
    if (!defsOk()) return prepMsg();
    const cfg = S.defs.config;
    const active = activeSpecials(), inv = invOf(m.g);
    return ['bronze', 'silber', 'gold', 'spezial'].filter(k => cfg.packs[k]).map(k => {
      const P = cfg.packs[k], blocked = k === 'spezial' && !active.length, can = m.points >= P.price && !blocked;
      return `<div class="gc-pack${k === 'spezial' ? ' x' : ''}" style="background:${PACK_COLOR[k]}"><div style="flex:1;min-width:0;">
          <div style="font:800 1.1rem var(--hd);">${PACK_NAME[k]}</div><div style="font-size:.78rem;">${P.n} Karten · ${P.price} Punkte</div>
          <div style="font-size:.7rem;margin-top:4px;opacity:.85;">${blocked ? 'Verfügbar, sobald nach einem Rennen Spezialkarten entstanden sind.' : [['S', 'Silber+'], ['G', 'Gold+'], ['X', 'Spezial']].map(([t, l]) => [l, pAt(P, t)]).filter(x => x[1] < 0.995).map(([l, v]) => `Mind. 1× ${l} ${pct(v)}`).join(' · ')}${cfg.icon && cfg.icon.chance[k] ? ' · Mind. 1× Icon ' + pct(1 - (1 - cfg.icon.chance[k]) ** P.n) : ''}</div></div>
        <button class="btn" style="margin:0;width:auto;padding:10px 16px;background:#0e1a14;color:var(--y);${can ? '' : 'opacity:.45;'}" data-act="buy" data-pack="${k}" ${can && !S.pending ? '' : 'disabled'}>${S.pending === 'buy' ? '...' : 'Kaufen'}</button></div>`;
    }).join('') + (m.g.last && m.g.cardVer === CARD_VER ? '<button class="btn ghost" data-act="lastpack">Letztes Pack nochmal ansehen</button>' : '')
      + `<div style="font-weight:700;margin:16px 0 6px;">Aktuell im Spezial-Pack</div>` + (active.length
        ? `<div class="gc-grid">${active.slice(0, 9).map(x => `<div data-act="detail" data-key="special:${esc(x.id)}">${cardHtml('special:' + x.id, { locked: !inv['special:' + x.id], count: inv['special:' + x.id] })}</div>`).join('')}</div><div style="font-size:.72rem;color:var(--m);margin-top:6px;">Im Pack stecken nur die Inform-Karten der letzten 3 Rennen.</div>`
        : '<div style="color:var(--m);font-size:.85rem;">Nach jedem Rennen entstehen Inform-Karten für Sieger, Podium, Pole, schnellste Runde und Aufholjagd.</div>');
  }

  function albumHtml(m) {
    if (!defsOk()) return prepMsg();
    const inv = invOf(m.g), A = S.album, season = A.season || curSeason(), seasons = seasonsList();
    const kinds = [['driver', 'Fahrer'], ['team', 'Teams'], ['principal', 'Chefs'], ['icon', 'Icons'], ['track', 'Strecken'], ['special', 'Inform']];
    const stat = kind => { const ks = poolKeys(kind, 'all', season); return [ks.filter(k => inv[k]).length, ks.length]; };
    const allBase = ['driver', 'team', 'track', 'principal', 'icon'].map(stat), own = allBase.reduce((t, x) => t + x[0], 0), tot = allBase.reduce((t, x) => t + x[1], 0);
    const keys = poolKeys(A.kind, A.kind === 'special' || A.kind === 'icon' ? 'all' : A.rarity, season);
    return `${seasons.length > 1 ? `<div class="tabs" style="flex-wrap:nowrap;overflow-x:auto;margin-bottom:8px;">${seasons.map(n => `<button class="tab-btn ${n === season ? 'active' : ''}" data-act="album" data-season="${n}">Saison ${n}${n === curSeason() ? '' : ' (Archiv)'}</button>`).join('')}</div>` : ''}
      <div style="font-size:.8rem;margin-bottom:6px;">Sammlung Saison ${season}: <b>${own}/${tot}</b> Basiskarten (${tot ? Math.round(100 * own / tot) : 0} %)</div>
      <div style="height:6px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden;margin-bottom:10px;"><div style="width:${tot ? 100 * own / tot : 0}%;height:100%;background:var(--y);"></div></div>
      <div class="tabs" style="flex-wrap:nowrap;overflow-x:auto;margin-bottom:8px;">${kinds.map(([k, l]) => { const [o, t] = stat(k); return `<button class="tab-btn ${A.kind === k ? 'active' : ''}" data-act="album" data-kind="${k}">${l} ${o}/${t}</button>`; }).join('')}</div>
      ${A.kind === 'special' || A.kind === 'icon' ? '' : `<div class="tabs" style="flex-wrap:nowrap;overflow-x:auto;margin-bottom:10px;">${[['all', 'Alle'], ['B', 'Bronze'], ['S', 'Silber'], ['G', 'Gold']].map(([k, l]) => `<button class="tab-btn ${A.rarity === k ? 'active' : ''}" data-act="album" data-rarity="${k}">${l}</button>`).join('')}</div>`}
      ${keys.length ? `<div class="gc-grid">${keys.map(k => `<div data-act="detail" data-key="${esc(k)}">${cardHtml(k, { locked: !inv[k], count: inv[k] })}</div>`).join('')}</div>` : '<div style="color:var(--m);font-size:.85rem;">Hier gibt es noch keine Karten.</div>'}`;
  }

  function cardsHtml() {
    if (!S.login) return loginHtml();
    const m = me(), old = (m.g.inv || m.g.spent) && m.g.cardVer !== CARD_VER;
    return loginHtml() + (old ? '<div class="note gold">Das Kartensystem wurde umgebaut: Dein altes Album wird beim nächsten Gießen oder Kauf zurückgesetzt, alle dafür ausgegebenen Punkte bekommst du zurück.</div>' : '')
      + `<div class="tabs" style="margin-bottom:10px;"><button class="tab-btn ${S.cardsTab === 'shop' ? 'active' : ''}" data-act="cardsTab" data-v="shop">🛒 Shop</button><button class="tab-btn ${S.cardsTab === 'album' ? 'active' : ''}" data-act="cardsTab" data-v="album">📖 Album</button></div>`
      + (S.cardsTab === 'shop' ? shopHtml(m) : albumHtml(m));
  }

  // ---------- Events ----------
  root.addEventListener('input', e => { if (e.target.id) drafts[e.target.id] = e.target.value; });
  root.addEventListener('change', e => { if (e.target.id) drafts[e.target.id] = e.target.value; });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (t) act(t.dataset.act, t.dataset);
  });

  async function act(a, data = {}) {
    if (a === 'close') return closeOv();
    if (a === 'revealall') { ov.querySelectorAll('.gc-flip').forEach((f, i) => setTimeout(() => f.classList.add('open'), i * 250)); return; }
    if (a === 'cardsTab') { S.cardsTab = data.v; S.msg = ''; return render(); }
    if (a === 'album') { if (data.kind) S.album.kind = data.kind; if (data.rarity) S.album.rarity = data.rarity; if (data.season) S.album.season = +data.season; return render(); }
    if (a === 'detail') return openDetail(data.key);
    if (a === 'lastpack') { const l = S.login && S.garden[S.login.name] && S.garden[S.login.name].last; if (l) openReveal(Object.values(l.keys), l.isNew && Object.values(l.isNew), true); return; }
    if (a === 'tab') { S.tab = data.tab; S.msg = ''; S.info = ''; return render(); }
    if (a === 'logout') { S.login = null; localStorage.removeItem('pressLogin'); return render(); }
    if (a === 'login') {
      const name = document.getElementById('gardenName')?.value, pin = (document.getElementById('gardenPin')?.value || '').trim();
      if (!name || !pin) { S.msg = 'Bitte Namen und PIN angeben.'; return render(); }
      S.login = { name, pin }; localStorage.setItem('pressLogin', JSON.stringify(S.login)); drafts.gardenPin = '';
      return render();
    }
    if (a.startsWith('cs_')) return S.login ? casino.act(a, data) : undefined;
    if (a.startsWith('lt_')) return S.login ? lotto.act(a, data) : undefined;
    if (!S.login || S.pending) return;
    if (a === 'claim') {
      const j = await api('claim', {});
      if (j) { S.info = `+${j.gain} Gurkenpunkte${j.first ? `, Serie: ${j.streak} Tag${j.streak === 1 ? '' : 'e'}` : ''}`; render(); }
    } else if (a === 'buy') {
      const j = await api('buy', { pack: data.pack });
      if (j) openReveal(j.keys, j.isNew);
    } else if (a === 'melt') {
      const j = await api('melt', { key: data.key, all: data.all === '1' });
      if (j) { closeOv(); S.info = `+${j.gain} Gurkenpunkte durch Einschmelzen`; render(); }
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
