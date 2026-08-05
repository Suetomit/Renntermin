#!/usr/bin/env node
/**
 * Gurkensöhne Cup - Discord Renntermin-Announcer
 * ================================================
 * Zweck: Wird per GitHub Actions Cron alle paar Minuten kurz gestartet,
 * läuft dann durch und beendet sich wieder - läuft NICHT dauerhaft und
 * braucht deshalb keinen eigenen Server.
 *
 * Ablauf:
 *  1. Liest den aktuellen Renntermin (renntermin/confirmedDate/...) aus
 *     der Firebase Realtime Database (dieselbe DB, die auch die Website
 *     nutzt).
 *  2. Vergleicht ihn mit dem zuletzt angekündigten Termin, der unter
 *     discordBot/lastAnnouncedDate in derselben DB gespeichert wird -
 *     das ist das "Gedächtnis" des Bots zwischen den einzelnen Läufen.
 *  3a. Neuer Termin -> legt ein Discord "Scheduled Event" an und postet
 *      eine Nachricht im Ankündigungs-Channel.
 *  3b. Termin wurde aufgehoben -> löscht das alte Scheduled Event wieder
 *      und postet eine kurze Hinweis-Nachricht.
 *  4. Ändert sich nichts, passiert nichts (kein Spam bei jedem Lauf).
 *
 * WICHTIG: Das Skript nutzt NUR die Discord-REST-API (fetch-Aufrufe mit
 * Bot-Token), keine dauerhafte Gateway-Verbindung (discord.js o.ä.) - das
 * ist für einen kurzlebigen Cron-Job genau richtig und braucht keine
 * zusätzlichen npm-Pakete.
 */

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL; // z.B. https://gurkensohne-cup-default-rtdb.europe-west1.firebasedatabase.app
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_ANNOUNCE_CHANNEL_ID = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
const DISCORD_VOICE_CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID || null; // optional
const PING_EVERYONE = (process.env.PING_EVERYONE || 'false').toLowerCase() === 'true';

const DISCORD_API = 'https://discord.com/api/v10';

function requireEnv(name, value) {
  if (!value) {
    console.error(`❌ Fehlende Umgebungsvariable: ${name} (als GitHub Secret gesetzt?)`);
    process.exit(1);
  }
}

requireEnv('FIREBASE_DB_URL', FIREBASE_DB_URL);
requireEnv('DISCORD_BOT_TOKEN', DISCORD_BOT_TOKEN);
requireEnv('DISCORD_GUILD_ID', DISCORD_GUILD_ID);
requireEnv('DISCORD_ANNOUNCE_CHANNEL_ID', DISCORD_ANNOUNCE_CHANNEL_ID);

// -------------------------------------------------------------------------
// Firebase REST-Helfer (kein SDK nötig, funktioniert wie die Website es
// eh schon macht: einfache HTTPS-Requests gegen die RTDB-REST-Schnittstelle)
// -------------------------------------------------------------------------

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET ${path} fehlgeschlagen: ${res.status}`);
  return res.json();
}

async function fbPut(path, data) {
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase PUT ${path} fehlgeschlagen: ${res.status} ${body}`);
  }
  return res.json();
}

// -------------------------------------------------------------------------
// Discord REST-Helfer
// -------------------------------------------------------------------------

async function discordRequest(endpoint, options = {}) {
  const res = await fetch(`${DISCORD_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API ${endpoint} fehlgeschlagen: ${res.status} ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function fmtDateGerman(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function postMessage(content) {
  await discordRequest(`/channels/${DISCORD_ANNOUNCE_CHANNEL_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

async function createScheduledEvent(dateIso, startTime, endTime) {
  const startISO = new Date(`${dateIso}T${startTime}:00`).toISOString();
  const endISO = new Date(`${dateIso}T${endTime}:00`).toISOString();

  const body = {
    name: '🏁 Gurkensöhne Cup Rennen',
    privacy_level: 2, // GUILD_ONLY (einzig gültiger Wert für Scheduled Events)
    scheduled_start_time: startISO,
    description: `Renntermin des Gurkensöhne Cup am ${fmtDateGerman(dateIso)}, ${startTime}-${endTime} Uhr.`,
  };

  if (DISCORD_VOICE_CHANNEL_ID) {
    // Event ist an einen Voice-Channel gebunden -> Discord übernimmt die
    // Endzeit automatisch beim Verlassen des Channels, muss hier nicht
    // gesetzt werden (darf laut API bei VOICE-Events auch nicht gesetzt sein).
    body.entity_type = 2; // VOICE
    body.channel_id = DISCORD_VOICE_CHANNEL_ID;
  } else {
    // Ohne Voice-Channel: EXTERNAL-Event, braucht zwingend eine Endzeit
    // und einen "Ort" (auch wenn online gefahren wird).
    body.entity_type = 3; // EXTERNAL
    body.scheduled_end_time = endISO;
    body.entity_metadata = { location: 'F1 25 - Online' };
  }

  return discordRequest(`/guilds/${DISCORD_GUILD_ID}/scheduled-events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function deleteScheduledEvent(eventId) {
  try {
    await discordRequest(`/guilds/${DISCORD_GUILD_ID}/scheduled-events/${eventId}`, { method: 'DELETE' });
  } catch (e) {
    // Kein harter Fehler - z.B. wenn das Event bereits manuell gelöscht wurde
    console.warn(`⚠️ Konnte Event ${eventId} nicht löschen (evtl. schon weg): ${e.message}`);
  }
}

// -------------------------------------------------------------------------
// Hauptlogik
// -------------------------------------------------------------------------

async function main() {
  const renntermin = await fbGet('renntermin');
  const state = (await fbGet('discordBot')) || {};

  const confirmedDate = renntermin?.confirmedDate || null;
  const confirmedStart = renntermin?.confirmedStart || '14:00';
  const confirmedEnd = renntermin?.confirmedEnd || '18:00';

  const lastDate = state.lastAnnouncedDate || null;
  const lastEventId = state.discordEventId || null;

  if (confirmedDate === lastDate) {
    console.log('ℹ️ Kein neuer/geänderter Renntermin - nichts zu tun.');
    return;
  }

  // Fall 1: Termin wurde AUFGEHOBEN (war gesetzt, ist jetzt leer)
  if (!confirmedDate && lastDate) {
    console.log(`🚩 Renntermin (${lastDate}) wurde aufgehoben - räume auf.`);
    if (lastEventId) await deleteScheduledEvent(lastEventId);
    await postMessage(
      `⚠️ Der Renntermin am **${fmtDateGerman(lastDate)}** wurde wieder aufgehoben. ` +
      `Neuer Termin folgt, sobald genug Fahrer verfügbar sind.`
    );
    await fbPut('discordBot', { lastAnnouncedDate: null, discordEventId: null });
    return;
  }

  // Fall 2: NEUER Termin wurde festgelegt (oder ein bestehender ersetzt)
  if (confirmedDate && confirmedDate !== lastDate) {
    console.log(`🏁 Neuer Renntermin: ${confirmedDate} - lege Discord-Event an.`);

    if (lastEventId) await deleteScheduledEvent(lastEventId); // alten Event aufräumen, falls vorhanden

    const event = await createScheduledEvent(confirmedDate, confirmedStart, confirmedEnd);

    const pingPrefix = PING_EVERYONE ? '@everyone ' : '';
    const eventLink = `https://discord.com/events/${DISCORD_GUILD_ID}/${event.id}`;
    await postMessage(
      `${pingPrefix}🏁 **Neuer Renntermin für den Gurkensöhne Cup!**\n` +
      `📅 ${fmtDateGerman(confirmedDate)}\n` +
      `🕐 ${confirmedStart} - ${confirmedEnd} Uhr\n\n` +
      `Details & Zusage im Discord-Event: ${eventLink}`
    );

    await fbPut('discordBot', { lastAnnouncedDate: confirmedDate, discordEventId: event.id });
    console.log('✅ Event angelegt und Nachricht gepostet.');
  }
}

main().catch(err => {
  console.error('❌ Fehler im Discord-Bot-Skript:', err);
  process.exit(1);
});
