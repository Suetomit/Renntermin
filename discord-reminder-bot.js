#!/usr/bin/env node
/**
 * Gurkensöhne Cup - Discord Eintrage-Erinnerung
 * ================================================
 * Zweck: Separater Cron-Job (läuft z.B. 1x täglich), der in Firebase
 * nachschaut, wer seine Verfügbarkeit unter "Verfügbarkeit eintragen"
 * auf der Website NOCH NICHT eingetragen hat, und postet - falls jemand
 * fehlt - eine Erinnerung mit echtem Discord-Ping (@Name) im selben
 * Ankündigungs-Channel wie der Renntermin-Announcer.
 *
 * Läuft komplett unabhängig vom bestehenden discord-event-bot.js (eigener
 * Workflow, eigener Cron-Rhythmus), nutzt aber dieselben Secrets
 * (FIREBASE_DB_URL, DISCORD_BOT_TOKEN, DISCORD_ANNOUNCE_CHANNEL_ID) -
 * es muss also NICHTS neu in Discord eingerichtet werden.
 *
 * Ablauf:
 *  1. Liest renntermin/persons (wer hat schon eingetragen) und
 *     renntermin/confirmedDate (ist der Termin schon fix?) aus Firebase.
 *  2. Ist bereits ein Termin bestätigt -> nichts zu tun, das Eintragen
 *     hat für diese Runde seinen Zweck erfüllt.
 *  3. Sonst: vergleicht die eingetragenen Namen mit der festen Fahrerliste
 *     unten (DRIVER_DISCORD_IDS) und postet bei Bedarf eine Ping-Nachricht
 *     für alle, die noch fehlen.
 *
 * WICHTIG - einmalig auszufüllen: DRIVER_DISCORD_IDS unten mit den
 * echten Discord-User-IDs der 8 Fahrer befüllen (siehe SETUP.md,
 * Abschnitt "Reminder-Bot"). Ohne User-ID wird der Name nur als Klartext
 * erwähnt (kein Ping, aber die Nachricht bricht deswegen nicht ab).
 */

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_ANNOUNCE_CHANNEL_ID = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
// Optional: Link zur Website, wird in der Erinnerung mit angezeigt, falls gesetzt.
const WEBSITE_URL = process.env.WEBSITE_URL || null;

const DISCORD_API = 'https://discord.com/api/v10';

// Liga-Vorname (exakt wie er auf der Website als Button/als p.name in
// renntermin/persons gespeichert wird) -> Discord User-ID.
// User-ID herausfinden: Discord-Entwicklermodus an (Einstellungen -> Erweitert),
// dann Rechtsklick auf den Nutzernamen -> "Nutzer-ID kopieren".
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

function requireEnv(name, value) {
  if (!value) {
    console.error(`❌ Fehlende Umgebungsvariable: ${name} (als GitHub Secret gesetzt?)`);
    process.exit(1);
  }
}

requireEnv('FIREBASE_DB_URL', FIREBASE_DB_URL);
requireEnv('DISCORD_BOT_TOKEN', DISCORD_BOT_TOKEN);
requireEnv('DISCORD_ANNOUNCE_CHANNEL_ID', DISCORD_ANNOUNCE_CHANNEL_ID);

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET ${path} fehlgeschlagen: ${res.status}`);
  return res.json();
}

async function postMessage(content) {
  const res = await fetch(`${DISCORD_API}/channels/${DISCORD_ANNOUNCE_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API Nachricht senden fehlgeschlagen: ${res.status} ${body}`);
  }
}

function mentionOrName(name) {
  const id = DRIVER_DISCORD_IDS[name];
  return id ? `<@${id}>` : `**${name}**`;
}

async function main() {
  const renntermin = await fbGet('renntermin');
  const persons = renntermin?.persons || [];
  const confirmedDate = renntermin?.confirmedDate || null;

  if (confirmedDate) {
    console.log(`ℹ️ Termin (${confirmedDate}) bereits bestätigt - keine Erinnerung nötig.`);
    return;
  }

  const entered = persons.filter(p => Array.isArray(p.slots) && p.slots.length > 0).map(p => p.name);
  const allDrivers = Object.keys(DRIVER_DISCORD_IDS);
  const missing = allDrivers.filter(name => !entered.includes(name));

  if (!missing.length) {
    console.log('✅ Alle Fahrer haben eingetragen - keine Erinnerung nötig.');
    return;
  }

  const mentions = missing.map(mentionOrName).join(' ');
  const linkLine = WEBSITE_URL ? `\n👉 ${WEBSITE_URL}` : '';

  await postMessage(
    `⏰ **Erinnerung: Verfügbarkeit eintragen!**\n` +
    `Es fehlen noch: ${mentions}${linkLine}`
  );

  console.log(`📣 Erinnerung gepostet für: ${missing.join(', ')}`);
}

main().catch(err => {
  console.error('❌ Fehler im Reminder-Bot-Skript:', err);
  process.exit(1);
});
