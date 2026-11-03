// Rivalitäten-Bot (Gurkensöhne Cup). Läuft per GitHub Actions (siehe rivalry-bot.yml) und erledigt automatisch:
//  1. beendete Duelle abrechnen (Sieger stiehlt Ansehen), wartende Rivalitäten nachrücken lassen, veraltete verfallen lassen
//  1b. Anfragen der Presse (press/rivalryRequests, vom Lätti-Worker) in Rivalitäten vom Typ "press" umwandeln
//  2. neue Rivalitäten anlegen: Teamrivalität, Titelkampf, nahe WM-Punkte (nur mit freien Plätzen, max. 3 aktive je Fahrer)
//  3. kurze Meldungen nach /rivalryNews schreiben (erscheinen als News auf der Startseite)
// Die Rechenregeln stammen aus rivalry.js (identisch mit Website und Admin). Elo wird nicht angefasst.
import * as RL from './rivalry.mjs';
import { fileURLToPath } from 'url';

const DB_URL = 'https://gurkensohne-cup-default-rtdb.europe-west1.firebasedatabase.app';
const MAX_NEW_PER_RUN = 2;   // höchstens so viele neue Rivalitäten pro Durchlauf
const CLOSE_POINTS = 3;      // "nahe WM-Punkte": höchstens so viele Punkte Abstand
const TITLE_GAP = 12;        // Titelkampf: Abstand P1 zu P2 höchstens so groß
const F1 = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };
const COUNTRY = { AUS: 'Australien', CHN: 'China', JPN: 'Japan', BHR: 'Bahrain', SAU: 'Saudi-Arabien', MIA: 'USA', IMO: 'Emilia-Romagna', MCO: 'Monaco', ESP: 'Spanien', CAN: 'Kanada', AUT: 'Österreich', GBR: 'Großbritannien', BEL: 'Belgien', HUN: 'Ungarn', NLD: 'Niederlande', ITA: 'Italien', AZE: 'Aserbaidschan', SGP: 'Singapur', USA: 'USA', MEX: 'Mexiko', BRA: 'Brasilien', VGS: 'USA', QAT: 'Katar', UAE: 'Ver. Arab. Emirate' };
const LABEL = { press: 'Presse', points: 'WM-Punkte', title: 'Titelkampf', team: 'Teamrivalität' };

// Reine Planung ohne Datenbankzugriff (gut testbar): gibt zu schreibende Rivalitäten, Meldungen und bearbeitete Presse-Anfragen zurück.
export function plan({ RR, RS, TA, roster, cal, RV, season, news, reqs }, now = Date.now()) {
  const codes = cal.length ? cal : Object.keys(COUNTRY);
  const races = codes.map((c, i) => ({ num: i + 1, country: COUNTRY[c] || c, done: !!RS[i + 1] }));
  const ctx = { RR, TA, roster, races };
  const R = JSON.parse(JSON.stringify(RV)), writes = {}, texts = [], reqWrites = {};
  const nm = n => { const d = roster.find(x => x.name === n); return d ? (d.human || d.name) : n; };
  const say = (key, text) => { if (!news[key]) texts.push([key, text]); };
  const startText = rv => `🥊 Neue Rivalität (${LABEL[rv.type] || 'Rivalität'}): ${nm(rv.a)} gegen ${nm(rv.b)}. Drei Rennen, bis zu vier Punkte pro Wochenende.`;

  // 1. abrechnen, nachrücken, verfallen
  for (const [id, rv] of Object.entries(RL.planSettle(ctx, R))) {
    const before = R[id].status; R[id] = writes[id] = rv;
    if (rv.status === 'finished') {
      const r = rv.result;
      if (r.winner) {
        const l = r.winner === rv.a ? rv.b : rv.a, ws = r.winner === rv.a ? r.ta : r.tb, ls = r.winner === rv.a ? r.tb : r.ta;
        say(`${id}_end`, `🥊 ${nm(r.winner)} gewinnt das Duell gegen ${nm(l)} mit ${ws}:${ls}${r.ko ? ' per Knockout' : ''} und stiehlt ${r.amount} Ansehen.`);
      } else say(`${id}_end`, `🤝 ${nm(rv.a)} und ${nm(rv.b)} trennen sich im Duell unentschieden (${r.ta}:${r.tb}).`);
    } else if (rv.status === 'expired') say(`${id}_exp`, `⌛ Die Rivalität ${nm(rv.a)} gegen ${nm(rv.b)} ist verfallen, es wurde kein Platz frei.`);
    else if (rv.status === 'active' && before === 'queued') say(`${id}_start`, startText(rv));
  }

  // 1b. Anfragen der Presse (Gerücht mit genannter Quelle + hitzige Antwort) -> Rivalität vom Typ "press", Regeln wie im Admin (rvAdd)
  for (const [rid, q] of Object.entries(reqs || {}).sort((x, y) => (x[1].ts || 0) - (y[1].ts || 0))) {
    if (!q || q.status) continue;
    const known = n => roster.some(d => d.name === n);
    if (!known(q.a) || !known(q.b) || q.a === q.b) { reqWrites[rid] = { ...q, status: 'skipped', note: 'unbekannter Fahrer' }; continue; }
    const dup = Object.values(R).some(r => ((r.a === q.a && r.b === q.b) || (r.a === q.b && r.b === q.a)) && ['active', 'queued'].includes(r.status));
    if (dup) { reqWrites[rid] = { ...q, status: 'skipped', note: 'läuft bereits' }; continue; }
    const queued = RL.activeCount(ctx, R, q.a) >= 3 || RL.activeCount(ctx, R, q.b) >= 3;
    const nx = races.find(r => !r.done), startRace = nx ? nx.num : races.length + 1;
    const id = `press${rid}`;
    const rv = { a: q.a, b: q.b, type: 'press', status: queued ? 'queued' : 'active', startRace, createdAt: now, season, auto: true, ...(queued ? { queueRace: startRace } : {}) };
    R[id] = writes[id] = rv;
    reqWrites[rid] = { ...q, status: 'done', rivalry: id };
    if (!queued) say(`${id}_start`, startText(rv)); // wartende Rivalitäten werden beim Nachrücken (Schritt 1) angekündigt
  }

  // 2. neue Rivalitäten (nur solange noch ein Rennen offen ist)
  const open = races.find(r => !r.done);
  if (open) {
    const pts = {}; roster.forEach(d => pts[d.name] = 0);
    Object.values(RR).forEach(r => Object.entries(r || {}).forEach(([n, e]) => { const p = RL.pp(e); if (F1[p] && n in pts) pts[n] += F1[p]; }));
    const table = [...roster].sort((a, b) => pts[b.name] - pts[a.name] || a.name.localeCompare(b.name));
    const doneCount = races.filter(r => r.done).length, cands = [], human = n => !!(roster.find(x => x.name === n) || {}).human;
    const byTeam = {}; roster.forEach(d => (byTeam[d.team] = byTeam[d.team] || []).push(d));
    Object.values(byTeam).forEach(m => { for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) if (m[i].human || m[j].human) cands.push([m[i].name, m[j].name, 'team']); });
    if (doneCount >= 1) {
      for (let i = 0; i < table.length - 1; i++) {
        const a = table[i].name, b = table[i + 1].name, gap = pts[a] - pts[b];
        if (!pts[a] || !(human(a) || human(b))) continue;
        if (i === 0 && gap <= TITLE_GAP) cands.push([a, b, 'title']);
        else if (gap <= CLOSE_POINTS) cands.push([a, b, 'points']);
      }
    }
    const taken = (a, b) => Object.values(R).some(r => ((r.a === a && r.b === b) || (r.a === b && r.b === a)) && (['active', 'queued'].includes(r.status) || (r.season ?? season) === season));
    let made = 0;
    for (const [a, b, type] of cands) {
      if (made >= MAX_NEW_PER_RUN) break;
      if (taken(a, b) || RL.activeCount(ctx, R, a) >= 3 || RL.activeCount(ctx, R, b) >= 3) continue;
      const id = `auto${now}_${made}`, rv = { a, b, type, status: 'active', startRace: open.num, createdAt: now + made, season, auto: true };
      R[id] = writes[id] = rv; made++; say(`${id}_start`, startText(rv));
    }
  }
  return { writes, texts, reqWrites };
}

async function main() {
  const { default: admin } = await import('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: DB_URL });
  const db = admin.database(), get = async p => (await db.ref(p).once('value')).val();
  const toArr = v => v ? (Array.isArray(v) ? v : Object.values(v)).filter(x => x != null) : [];
  const [RR, RS, TA, rosterRaw, calRaw, RV, season, news, reqs] = await Promise.all(['raceResults', 'raceStatus', 'telemetryArchive', 'driverRoster', 'raceCalendarCodes', 'rivalries', 'currentSeason', 'rivalryNews', 'press/rivalryRequests'].map(get));
  const roster = toArr(rosterRaw);
  if (!roster.length) { console.log('Kein driverRoster in Firebase gespeichert, nichts zu tun.'); return; }
  const { writes, texts, reqWrites } = plan({ RR: RR || {}, RS: RS || {}, TA: TA || {}, roster, cal: toArr(calRaw), RV: RV || {}, season: season || 1, news: news || {}, reqs: reqs || {} });
  console.log(`Rivalitäten geändert/neu: ${Object.keys(writes).length}, neue Meldungen: ${texts.length}, Presse-Anfragen bearbeitet: ${Object.keys(reqWrites).length}`);
  if (process.env.DRY_RUN) { console.log(JSON.stringify({ writes, texts, reqWrites }, null, 1)); return; }
  for (const [id, rv] of Object.entries(writes)) await db.ref('rivalries/' + id).set(rv);
  for (const [key, text] of texts) await db.ref('rivalryNews/' + key).set({ ts: Date.now(), text });
  for (const [rid, q] of Object.entries(reqWrites)) await db.ref('press/rivalryRequests/' + rid).set(q);
  console.log('Fertig.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
