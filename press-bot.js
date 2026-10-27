#!/usr/bin/env node
/**
 * Gurkensöhne Cup - Lätti Fragen-Bot
 * Läuft per GitHub Actions Cron (siehe press-bot.yml), erzeugt bei Bedarf Interviewfragen
 * und legt sie unter press/questions in Firebase ab.
 *
 * Auslöser:
 *  1. Neues Rennergebnis (raceResults) -> je Mensch mit Ergebnis eine Frage zum Anlass (Sieg, Podium, Ausfall, ...)
 *  2. Flaute: seit 7 Tagen keine Frage -> eine allgemeine Frage an einen zufälligen Fahrer
 * Regeln: max. 1 offene Frage pro Fahrer, offene Fragen laufen nach 5 Tagen ab.
 *
 * Env: FIREBASE_DB_URL, GEMINI_API_KEY (Pflicht); GEMINI_MODEL, DISCORD_BOT_TOKEN,
 *      DISCORD_ANNOUNCE_CHANNEL_ID, WEBSITE_URL (optional)
 */

const { FIREBASE_DB_URL, GEMINI_API_KEY, DISCORD_BOT_TOKEN, DISCORD_ANNOUNCE_CHANNEL_ID, WEBSITE_URL } = process.env;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
for (const [n, v] of [['FIREBASE_DB_URL', FIREBASE_DB_URL], ['GEMINI_API_KEY', GEMINI_API_KEY]]) {
  if (!v) { console.error(`❌ Fehlende Umgebungsvariable: ${n}`); process.exit(1); }
}

const DAY = 86400000;
const EXPIRE_MS = 5 * DAY;
const IDLE_MS = 7 * DAY;
const TONES = ['hitzig', 'cool', 'boese', 'nett'];

const DEFAULT_HUMANS = {
  Timo: 'Timotheus Müller', Pascale: 'Pascale Braasch', Niklas: 'Niklas Schweisfurth', Tim: 'Tim Löffler',
  Marcel: 'Marcel Walle', Yannis: 'Yannis Herling', Eric: 'Eric Walter', Philipp: 'Philipp Juny', Vivien: 'Vivien Nadler', Cedric: 'Cedric Geppert',
};
const DISCORD_IDS = {
  Timo: '267013828896751617', Niklas: '434028182031826955', Pascale: '516216838368002069', Tim: '218849735107149824',
  Marcel: '248567421969891330', Yannis: '337359211401052161', Eric: '682018019643621425', Philipp: '709137556410728488', Cedric: '498536155101528084', Vivien: '924661655684677663',
};

const PERSONA = `Du bist Lätti, Reporterin im Fahrerlager des "Gurkensöhne Cup" (private F1-25-Sim-Liga unter Freunden). ` +
  `Du bist neugierig, schlagfertig, frech aber fair und schreibst locker auf Deutsch wie eine echte Motorsport-Reporterin. ` +
  `Du hast ein Gedächtnis und beziehst dich auf frühere Antworten. Erfinde keine Rennfakten, die nicht im Kontext stehen.`;

async function fb(method, path, data) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`, { method, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!r.ok) throw new Error(`Firebase ${method} ${path}: ${r.status}`);
  return r.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gemini(system, prompt) {
  const models = [MODEL, process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-lite-latest'];
  let busy = false, quota = false;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.95, maxOutputTokens: 800, responseMimeType: 'application/json' },
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const txt = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        return JSON.parse(txt.replace(/```json|```/g, '').trim());
      }
      if (r.status === 429) { quota = true; break; }
      if (r.status === 404) break;
      if (r.status >= 500) { busy = true; await sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }
  if (quota && !busy) throw new Error('Gemini-Kontingent aufgebraucht (429)');
  throw new Error('Gemini überlastet oder nicht erreichbar - beim nächsten Lauf nochmal');
}

async function getHumans() {
  const r = await fb('GET', 'driverRoster');
  const list = r ? (Array.isArray(r) ? r : Object.values(r)) : [];
  const m = {};
  list.filter(d => d && d.human).forEach(d => { m[d.human] = d.name; });
  return Object.keys(m).length ? m : DEFAULT_HUMANS;
}

function reasonFor(e, allEntries) {
  const p = String(e.pos || '').trim();
  const num = /^\d+$/.test(p) ? parseInt(p) : null;
  if (e.fastestLap) return `schnellste Rennrunde (Ergebnis: ${num ? 'P' + num : p || 'unbekannt'})`;
  if (num === 1) return 'Rennsieg';
  if (num && num <= 3) return `Podium (P${num})`;
  if (num === null && p) return `Ausfall (${p})`;
  if (num && num > 10) return `Zielankunft außerhalb der Punkte (P${num})`;
  return `Mittelfeld-Ergebnis (P${num})`;
}

async function makeQuestion(driver, reason, raceInfo, profile, oldQuestions) {
  const memo = profile
    ? `Profil: ${profile.label || '-'}; Merkmale: ${(profile.traits || []).join(', ') || '-'}; frühere Eindrücke: ${(profile.recent || []).slice(0, 4).map(r => r.t).join(' | ') || '-'}`
    : 'Noch kein Profil vorhanden.';
  const out = await gemini(
    PERSONA,
    `Stelle ${driver} EINE Interviewfrage (max. 25 Wörter) zum Anlass: ${reason}.\n${raceInfo}\n${memo}\n` +
    `Beziehe dich wenn passend auf frühere Eindrücke. Diese Fragen wurden schon gestellt, wiederhole sie nicht: ${oldQuestions.join(' | ') || '-'}\n` +
    'Antworte NUR mit JSON: {"question":"..."}'
  );
  return String(out.question || '').trim().slice(0, 300);
}

async function pingDiscord(drivers) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_ANNOUNCE_CHANNEL_ID || !drivers.length) return;
  const mentions = drivers.map(n => (DISCORD_IDS[n] ? `<@${DISCORD_IDS[n]}>` : `**${n}**`)).join(' ');
  const r = await fetch(`https://discord.com/api/v10/channels/${DISCORD_ANNOUNCE_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `🎙️ **Lätti hat eine Frage an euch:** ${mentions}${WEBSITE_URL ? `\n👉 ${WEBSITE_URL}` : ''}` }),
  });
  if (!r.ok) console.warn(`⚠️ Discord-Ping fehlgeschlagen: ${r.status}`);
}

async function main() {
  const now = Date.now();
  const [state0, questions0, results, season, humans] = await Promise.all([
    fb('GET', 'press/state'), fb('GET', 'press/questions'), fb('GET', 'raceResults'), fb('GET', 'currentSeason'), getHumans(),
  ]);
  const state = state0 || {};
  const questions = questions0 || {};

  // 1) Abgelaufene offene Fragen schließen
  for (const [id, q] of Object.entries(questions)) {
    if (q.status === 'offen' && now - (q.ts || 0) > EXPIRE_MS) {
      await fb('PUT', `press/questions/${id}`, { ...q, status: 'abgelaufen' });
      q.status = 'abgelaufen';
    }
  }

  const openFor = new Set(Object.values(questions).filter(q => q.status === 'offen').map(q => q.driver));
  const created = [];

  async function ask(driver, reason, raceInfo) {
    if (openFor.has(driver)) return;
    const profile = await fb('GET', `press/profiles/${driver}`);
    const old = Object.values(questions).filter(q => q.driver === driver).sort((a, b) => b.ts - a.ts).slice(0, 5).map(q => q.question);
    const question = await makeQuestion(driver, reason, raceInfo, profile, old);
    if (!question) return;
    const rec = { driver, question, reason, status: 'offen', ts: Date.now() };
    const res = await fb('POST', 'press/questions', rec);
    questions[res.name] = rec;
    openFor.add(driver);
    created.push(driver);
    console.log(`❓ ${driver}: ${question}`);
  }

  // 2) Auslöser: neues Rennergebnis
  const nums = Object.keys(results || {}).map(Number).filter(n => results[n] && Object.keys(results[n]).length).sort((a, b) => b - a);
  if (nums.length) {
    const latest = nums[0];
    const sig = `${season || 1}:${latest}:${Object.keys(results[latest]).length}`;
    if (sig !== state.lastRaceSig) {
      console.log(`🏁 Neues Rennergebnis erkannt (${sig}).`);
      const res = results[latest];
      const lines = Object.entries(humans).map(([short, full]) => {
        const e = res[full]; return e && String(e.pos || '').trim() ? `${short}: ${e.pos}` : null;
      }).filter(Boolean);
      const raceInfo = `Rennen #${latest}. Ergebnisse der Menschen: ${lines.join('; ')}.`;
      let quotaHit = false;
      for (const [short, full] of Object.entries(humans)) {
        const e = res[full];
        if (!e || !String(e.pos || '').trim()) continue;
        try { await ask(short, reasonFor(e), raceInfo); } catch (err) { console.warn(`⚠️ ${short}: ${err.message}`); if (/Kontingent|überlastet/.test(err.message)) { quotaHit = true; break; } }
      }
      // Bei aufgebrauchtem Gemini-Kontingent beim nächsten Lauf erneut versuchen (offene Fragen werden nicht doppelt gestellt)
      if (!quotaHit) state.lastRaceSig = sig;
    }
  }

  // 3) Flaute: lange keine Frage -> allgemeine Frage an einen zufälligen Fahrer
  if (!created.length && now - (state.lastQuestionTs || 0) > IDLE_MS) {
    const candidates = Object.keys(humans).filter(n => !openFor.has(n));
    if (candidates.length) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      try { await ask(pick, 'allgemeine Frage zur Saison, zur aktuellen Form oder zu einem Rivalen', 'Kein neues Rennen - es ist gerade ruhig in der Liga.'); }
      catch (err) { console.warn(`⚠️ ${pick}: ${err.message}`); }
    }
  }

  if (created.length) {
    state.lastQuestionTs = Date.now();
    await pingDiscord(created);
  }
  await fb('PUT', 'press/state', state);
  console.log(created.length ? `✅ ${created.length} neue Frage(n) erstellt.` : 'ℹ️ Nichts zu tun.');
}

main().catch(e => { console.error('❌ Fehler im Presse-Bot:', e); process.exit(1); });
