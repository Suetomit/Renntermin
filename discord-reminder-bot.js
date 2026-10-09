#!/usr/bin/env node
/**
 * Gurkensöhne Cup - Discord Erinnerung + Quorum-Regel
 * ====================================================
 * Regeln:
 *  1. Alle 8 können an einem Tag (min. 90 Min. gemeinsames Zeitfenster)
 *     -> Termin wird sofort bestätigt.
 *  2. Mindestens MIN_DRIVERS (Standard 7) können an einem Tag UND alle
 *     Fehlenden haben weder Termine eingetragen noch "Kann nicht" gedrückt
 *     -> die Fehlenden werden per Discord-Ping angeschrieben. Antworten sie
 *     innerhalb von DEADLINE_HOURS (Standard 72) nicht, wird der Termin ohne
 *     sie bestätigt (der discord-event-bot kündigt ihn danach an).
 *  3. Wer schon andere Tage eingetragen hat, aber an Tag X nicht kann, gilt
 *     als "hat geantwortet" - dann greift die Regel NICHT automatisch.
 *  4. Allgemeine Erinnerung an alle, die noch gar nicht reagiert haben
 *     (max. 1x pro GENERIC_REMINDER_INTERVAL_HOURS, damit häufigeres
 *     Cron-Intervall nicht spammt).
 *
 * Eigener Firebase-Pfad für den Bot-Zustand: reminderBot/...
 * (NICHT discordBot/..., das überschreibt der event-bot komplett.)
 * Die Website schreibt "Kann nicht" nach availabilityDeclined/{Name} = Timestamp.
 *
 * Optionale Env-Variablen: QUORUM_MIN_DRIVERS, QUORUM_DEADLINE_HOURS, WEBSITE_URL
 */

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_ANNOUNCE_CHANNEL_ID = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
const WEBSITE_URL = process.env.WEBSITE_URL || null;

const MIN_DRIVERS = parseInt(process.env.QUORUM_MIN_DRIVERS || '7', 10);
const DEADLINE_HOURS = parseInt(process.env.QUORUM_DEADLINE_HOURS || '72', 10);
const DECLINE_VALID_DAYS = 14;          // muss zur Website passen
const MIN_RACE_MINUTES = 90;            // gemeinsames Zeitfenster für Auto-Bestätigung
const GENERIC_REMINDER_INTERVAL_HOURS = 20;

const DISCORD_API = 'https://discord.com/api/v10';
const HOUR = 3600 * 1000;

const DRIVER_DISCORD_IDS = {
  'Timo':    '267013828896751617',
  'Niklas':  '434028182031826955',
  'Pascale': '516216838368002069',
  'Tim':     '218849735107149824',
  'Marcel':  '248567421969891330',
  'Yannis':  '337359211401052161',
  'Eric':    '682018019643621425',
  'Philipp': '709137556410728488',
};
const ALL_DRIVERS = Object.keys(DRIVER_DISCORD_IDS);

function requireEnv(name, value) {
  if (!value) {
    console.error(`❌ Fehlende Umgebungsvariable: ${name} (als GitHub Secret gesetzt?)`);
    process.exit(1);
  }
}
requireEnv('FIREBASE_DB_URL', FIREBASE_DB_URL);
requireEnv('DISCORD_BOT_TOKEN', DISCORD_BOT_TOKEN);
requireEnv('DISCORD_ANNOUNCE_CHANNEL_ID', DISCORD_ANNOUNCE_CHANNEL_ID);

// ---------------------------------------------------------------- Firebase
async function fbRequest(method, path, data) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase ${method} ${path} fehlgeschlagen: ${res.status} ${await res.text()}`);
  return res.json();
}
const fbGet = (path) => fbRequest('GET', path);
const fbPut = (path, data) => fbRequest('PUT', path, data);
const fbPatch = (path, data) => fbRequest('PATCH', path, data);

// ----------------------------------------------------------------- Discord
async function postMessage(content) {
  const res = await fetch(`${DISCORD_API}/channels/${DISCORD_ANNOUNCE_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord Nachricht fehlgeschlagen: ${res.status} ${await res.text()}`);
}

const mentionOrName = (name) => (DRIVER_DISCORD_IDS[name] ? `<@${DRIVER_DISCORD_IDS[name]}>` : `**${name}**`);
const linkLine = () => (WEBSITE_URL ? `\n👉 ${WEBSITE_URL}` : '');

// ----------------------------------------------------------------- Helfer
const asArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? Object.values(v) : []);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const todayBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); // YYYY-MM-DD
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });

function findIntersection(list) {
  let start = 0, end = 24 * 60;
  for (const s of list) { start = Math.max(start, toMin(s.from)); end = Math.min(end, toMin(s.to)); }
  return start < end ? { from: minToTime(start), to: minToTime(end), minutes: end - start } : null;
}

async function confirmRace(candidate, text) {
  await fbPatch('renntermin', {
    confirmedDate: candidate.date,
    confirmedStart: candidate.slot.from,
    confirmedEnd: candidate.slot.to,
  });
  await fbPut('reminderBot/pings', null);
  await postMessage(text);
  console.log(`🏁 Termin ${candidate.date} bestätigt.`);
}

// ------------------------------------------------------------------- Main
async function main() {
  const [renntermin, declinedRaw, botState] = await Promise.all([
    fbGet('renntermin'), fbGet('availabilityDeclined'), fbGet('reminderBot'),
  ]);
  const state = botState || {};
  const now = Date.now();

  if (renntermin?.confirmedDate) {
    console.log(`ℹ️ Termin (${renntermin.confirmedDate}) bereits bestätigt - nichts zu tun.`);
    if (state.pings) await fbPut('reminderBot/pings', null);
    return;
  }

  const persons = asArray(renntermin?.persons).filter(p => Array.isArray(p.slots) || p.slots);
  const withSlots = persons.filter(p => asArray(p.slots).length > 0);
  const entered = withSlots.map(p => p.name);
  const declined = Object.entries(declinedRaw || {})
    .filter(([, ts]) => now - ts < DECLINE_VALID_DAYS * 24 * HOUR)
    .map(([name]) => name);
  const silent = ALL_DRIVERS.filter(n => !entered.includes(n) && !declined.includes(n));

  // Kandidaten-Tage suchen
  const today = todayBerlin();
  const byDate = {};
  withSlots.forEach(p => asArray(p.slots).forEach(s => {
    if (s.date >= today) (byDate[s.date] = byDate[s.date] || []).push({ name: p.name, from: s.from, to: s.to });
  }));

  let best = null;
  for (const [date, list] of Object.entries(byDate)) {
    if (list.length < MIN_DRIVERS) continue;
    const available = list.map(l => l.name);
    const missing = ALL_DRIVERS.filter(n => !available.includes(n));
    if (!missing.every(n => silent.includes(n))) continue; // jemand hat geantwortet, kann aber nicht -> keine Auto-Regel
    const slot = findIntersection(list);
    if (!slot || slot.minutes < MIN_RACE_MINUTES) continue;
    const cand = { date, list, missing, slot };
    if (!best || list.length > best.list.length || (list.length === best.list.length && date < best.date)) best = cand;
  }

  if (best && best.missing.length === 0) {
    await confirmRace(best, `🏁 Alle 8 Fahrer können am **${fmtDate(best.date)}** - Termin steht! Die Ankündigung folgt gleich.`);
    return;
  }

  if (!best) {
    if (state.pings) await fbPut('reminderBot/pings', null); // Kandidat weg -> Fristen verfallen
  } else {
    const pings = state.pings || {};
    const newlyPinged = best.missing.filter(n => !pings[n] || pings[n].date !== best.date);
    newlyPinged.forEach(n => { pings[n] = { date: best.date, pingedAt: now }; });

    if (newlyPinged.length) {
      const deadline = new Date(now + DEADLINE_HOURS * HOUR).toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      await postMessage(
        `⏳ **Letzter Aufruf, ${newlyPinged.map(mentionOrName).join(' ')}!**\n` +
        `Am **${fmtDate(best.date)}** (${best.slot.from}-${best.slot.to} Uhr) können schon ${best.list.length} von ${ALL_DRIVERS.length} Fahrern.\n` +
        `Bitte trag dich bis **${deadline} Uhr** auf der Website ein - oder drück dort „Kann diese Runde an keinem Termin“, falls es nicht klappt.\n` +
        `Ohne Rückmeldung wird der Termin ohne dich festgelegt.${linkLine()}`
      );
      await fbPut('reminderBot/pings', pings);
      console.log(`📣 Frist gestartet für: ${newlyPinged.join(', ')}`);
    } else if (best.missing.every(n => now - pings[n].pingedAt >= DEADLINE_HOURS * HOUR)) {
      await confirmRace(
        best,
        `🏁 Die Frist ist abgelaufen: Es wird am **${fmtDate(best.date)}** ohne ${best.missing.map(mentionOrName).join(' ')} gefahren. ` +
        `Wer sich noch einträgt, ist bis zum Rennstart gern dabei! Die Ankündigung folgt gleich.`
      );
      return;
    } else {
      console.log('⏱️ Frist läuft noch.');
    }
  }

  // Allgemeine Erinnerung (gedrosselt) an alle, die noch gar nicht reagiert haben
  const alreadyPinged = best ? best.missing : [];
  const toRemind = silent.filter(n => !alreadyPinged.includes(n));
  const last = state.lastGenericReminder || 0;
  if (toRemind.length && now - last >= GENERIC_REMINDER_INTERVAL_HOURS * HOUR) {
    await postMessage(
      `⏰ **Erinnerung: Verfügbarkeit eintragen!**\n` +
      `Es fehlen noch: ${toRemind.map(mentionOrName).join(' ')}${linkLine()}`
    );
    await fbPut('reminderBot/lastGenericReminder', now);
    console.log(`📣 Erinnerung gepostet für: ${toRemind.join(', ')}`);
  } else if (!best) {
    console.log('ℹ️ Nichts zu tun.');
  }
}

main().catch(err => {
  console.error('❌ Fehler im Reminder-Bot-Skript:', err);
  process.exit(1);
});
