// Gurkensöhne Cup - Kartenkern (reine Funktionen, keine Datenbank).
// Der Worker enthält eine eingebettete Kopie dieser Datei (Build-Skript), hochladen musst du sie nicht.
// Zufall IMMER im Worker mit crypto, nie im Browser.

export const CARD_VERSION = 2;                 // bei Änderungen an Formeln, Seeds oder Pool erhöhen (alte Karten werden dann erstattet)
export const TIERS = ['B', 'S', 'G', 'X'];     // Bronze, Silber, Gold, Spezial
export const PACKS = {
  //            Karten, Preis, Wahrscheinlichkeit PRO KARTE für B / S / G / X
  bronze:  { n: 3, price: 100, p: [0.78, 0.18, 0.035, 0.005] },
  silber:  { n: 4, price: 250, p: [0.42, 0.42, 0.140, 0.020] },
  gold:    { n: 5, price: 575, p: [0.10, 0.43, 0.420, 0.050] },
  spezial: { n: 5, price: 900, p: [0.02, 0.13, 0.450, 0.400] },
};
export const QUICKSELL = { B: 4, S: 12, G: 40, X: 60 };        // Duplikat einschmelzen (je nach Pack ca. 21 bis 24 % vom Packpreis)
export const RARITY_RANGE = { B: [58, 64], S: [65, 74], G: [75, 90] };
export const STAT_KEYS = ['tmp', 'pac', 'con', 'ang', 'rel'];  // Tempo, Rennpace, Konstanz, Angriff, Zuverlässigkeit
export const STAT_WEIGHTS = { tmp: 0.2, pac: 0.2, con: 0.2, ang: 0.2, rel: 0.2 }; // GES = Durchschnitt der 5 Werte (so rechnen auch deine Vorgaben)
export const INFORM_BOOST = { win: 4, podium: 3, pole: 3, fl: 3, form: 4 };       // Bonus auf alle 5 Werte, bei mehreren Gründen +1 je weiterem, maximal +5
const SHRINK_K = 2, BLEND_K = 4;

export const rarityOf = ges => (ges <= 64 ? 'B' : ges <= 74 ? 'S' : 'G');
// Innerhalb einer Stufe sind Top-Karten seltener: Gewicht 1,5 (unterer Rand) bis 0,5 (oberer Rand)
export const weightOf = ges => { const r = RARITY_RANGE[rarityOf(ges)]; return Math.max(0.5, +(1.5 - (ges - r[0]) / (r[1] - r[0])).toFixed(3)); };
export const gesOf = st => Math.round(STAT_KEYS.reduce((t, k) => t + st[k], 0) / STAT_KEYS.length);
const toStats = a => Object.fromEntries(STAT_KEYS.map((k, i) => [k, a[i]]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- Saison-1-Seeds
// Reihenfolge der Werte: [Tempo, Rennpace, Konstanz, Angriff, Zuverlässigkeit]
export const HUMANS = {
  Timo: [75, 76, 74, 72, 73], Pascale: [71, 73, 75, 69, 72], Tim: [71, 69, 68, 70, 67], Yannis: [70, 68, 64, 73, 65], Niklas: [72, 70, 63, 71, 59],
  Marcel: [64, 66, 67, 63, 65], Cedric: [64, 63, 62, 63, 63], Eric: [62, 62, 61, 64, 61], Vivien: [61, 61, 63, 59, 61], Philipp: [62, 60, 58, 62, 58],
};
// KI-Fahrer: Ziel-GES aus F1 25 (auf 58-85 skaliert) plus Profil-Abweichung "off" (Summe immer 0, damit der Durchschnitt genau die Ziel-GES ergibt).
// Die Einzelwerte sind eine Ableitung aus Ziel-GES und Fahrertyp, keine Original-Werte aus F1 25. Team nur als Anzeige-Standard, die Fahrerliste hat Vorrang.
export const AI = {
  verstappen: { name: 'Max Verstappen', ges: 85, off: [2, 3, 1, 2, -8], team: 'Red Bull', badges: ['4× Weltmeister'] },
  norris: { name: 'Lando Norris', ges: 81, off: [2, 1, 0, 1, -4], team: 'McLaren', badges: ['Tempo-Spezialist'] },
  leclerc: { name: 'Charles Leclerc', ges: 81, off: [5, 0, -2, 2, -5], team: 'Ferrari', badges: ['Quali-Spezialist'] },
  russell: { name: 'George Russell', ges: 81, off: [2, 1, 3, -2, -4], team: 'Mercedes-AMG Petronas', badges: ['Akribisch'] },
  piastri: { name: 'Oscar Piastri', ges: 80, off: [1, 2, 3, 0, -6], team: 'McLaren', badges: ['Kühler Kopf'] },
  hamilton: { name: 'Lewis Hamilton', ges: 80, off: [1, 0, 3, 1, -5], team: 'Ferrari', badges: ['7× Weltmeister'] },
  alonso: { name: 'Fernando Alonso', ges: 78, off: [-1, 0, 3, 2, -4], team: 'Aston Martin', badges: ['2× Weltmeister', 'Routinier'] },
  hulkenberg: { name: 'Nico Hülkenberg', ges: 74, off: [-1, 0, 2, -2, 1], team: 'Kick Sauber', badges: ['Routinier'] },
  albon: { name: 'Alexander Albon', ges: 73, off: [0, 1, 2, -3, 0], team: 'Williams', badges: ['Punktesammler'] },
  gasly: { name: 'Pierre Gasly', ges: 73, off: [1, 0, 0, 1, -2], team: 'Alpine', badges: [] },
  sainz: { name: 'Carlos Sainz', ges: 73, off: [-1, 1, 3, -1, -2], team: 'Williams', badges: ['Stratege'] },
  ocon: { name: 'Esteban Ocon', ges: 70, off: [-1, 0, 1, 2, -2], team: 'Haas', badges: [] },
  hadjar: { name: 'Isack Hadjar', ges: 69, off: [3, 0, -3, 3, -3], team: 'Visa Cash App RB', badges: ['Rookie'] },
  antonelli: { name: 'Kimi Antonelli', ges: 67, off: [4, -1, -4, 3, -2], team: 'Mercedes-AMG Petronas', badges: ['Rookie'] },
  bearman: { name: 'Oliver Bearman', ges: 67, off: [2, 0, -3, 4, -3], team: 'Haas', badges: ['Rookie'] },
  bortoleto: { name: 'Gabriel Bortoleto', ges: 65, off: [2, 0, -3, 2, -1], team: 'Kick Sauber', badges: ['Rookie'] },
  tsunoda: { name: 'Yuki Tsunoda', ges: 63, off: [3, 0, -4, 4, -3], team: 'Red Bull', badges: ['Heißsporn'] },
  lawson: { name: 'Liam Lawson', ges: 63, off: [1, 0, -1, 2, -2], team: 'Visa Cash App RB', badges: [] },
  stroll: { name: 'Lance Stroll', ges: 63, off: [-3, -1, 3, -4, 5], team: 'Aston Martin', badges: ['Zuverlässig'] },
  colapinto: { name: 'Franco Colapinto', ges: 58, off: [2, -1, -4, 4, -1], team: 'Alpine', badges: ['Rookie'] },
};
// Teams und Strecken: genau eine Karte, feste Einordnung. Teams: [GES]; Strecken: [GES, Stadt, Land]
export const TEAMS = { 'McLaren': 86, 'Ferrari': 84, 'Mercedes-AMG Petronas': 82, 'Red Bull': 80, 'Williams': 70, 'Aston Martin': 68, 'Alpine': 66, 'Haas': 63, 'Visa Cash App RB': 62, 'Kick Sauber': 60 };
export const TRACK_SEED = {
  MCO: [90, 'Monte Carlo', 'Monaco'], ITA: [88, 'Monza', 'Italien'], BEL: [88, 'Spa-Francorchamps', 'Belgien'], GBR: [85, 'Silverstone', 'Großbritannien'], JPN: [84, 'Suzuka', 'Japan'], BRA: [80, 'São Paulo', 'Brasilien'],
  CAN: [74, 'Montreal', 'Kanada'], SGP: [74, 'Singapur', 'Singapur'], AUS: [73, 'Melbourne', 'Australien'], NLD: [72, 'Zandvoort', 'Niederlande'], USA: [72, 'Austin', 'USA'], VGS: [71, 'Las Vegas', 'USA'],
  ESP: [70, 'Barcelona', 'Spanien'], AUT: [70, 'Spielberg', 'Österreich'], HUN: [68, 'Hungaroring', 'Ungarn'], BHR: [66, 'Sachir', 'Bahrain'],
  CHN: [64, 'Shanghai', 'China'], SAU: [63, 'Dschidda', 'Saudi-Arabien'], MIA: [62, 'Miami', 'USA'], IMO: [62, 'Imola', 'Emilia-Romagna'], AZE: [61, 'Baku', 'Aserbaidschan'], MEX: [60, 'Mexiko-Stadt', 'Mexiko'], QAT: [59, 'Lusail', 'Katar'], UAE: [58, 'Abu Dhabi', 'Ver. Arab. Emirate'],
};
const ID_SAFE = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

// ---------------------------------------------------------------- Zuordnung zur Fahrerliste
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const lastOf = n => norm(n).split(/\s+/).pop();
export function rosterMatch(roster) {
  const hum = {}, ai = {};
  roster.forEach(d => { if (d.human) hum[norm(d.human)] = d; else ai[lastOf(d.name)] = d; });
  return { human: n => hum[norm(n)], ai: k => ai[k] };
}
const finish = c => { c.rarity = rarityOf(c.ges); c.weight = weightOf(c.ges); return c; };

// ---------------------------------------------------------------- Basiskarten
export function buildBaseS1(roster) {
  const rm = rosterMatch(roster), out = {};
  const put = c => { out[c.key] = finish(c); };
  for (const [name, arr] of Object.entries(HUMANS)) {
    const d = rm.human(name), stats = toStats(arr), id = 'H_' + ID_SAFE(name);
    put({ key: `driver:S1:${id}`, id, kind: 'driver', season: 1, name, short: name, human: true, src: 'h:' + name, rosterName: d ? d.name : null, team: d ? d.team || '' : '', photo: d && d.photo ? d.photo : '', badges: ['Saison-1-Rookie'], stats, ges: gesOf(stats) });
  }
  for (const [k, o] of Object.entries(AI)) {
    const d = rm.ai(k), stats = toStats(o.off.map(x => o.ges + x)), id = 'A_' + k;
    put({ key: `driver:S1:${id}`, id, kind: 'driver', season: 1, name: o.name, short: o.name.split(' ').pop(), human: false, src: 'a:' + k, rosterName: d ? d.name : null, team: d ? d.team || o.team : o.team, photo: d && d.photo ? d.photo : '', badges: o.badges, stats, ges: gesOf(stats) });
  }
  for (const [team, ges] of Object.entries(TEAMS)) { const id = ID_SAFE(team); put({ key: `team:S1:${id}`, id, kind: 'team', season: 1, name: team, ges }); }
  for (const [code, [ges, city, country]] of Object.entries(TRACK_SEED)) put({ key: `track:S1:${code}`, id: code, kind: 'track', season: 1, code, name: city, country, ges });
  return out;
}

// Ab Saison 2: Werte aus den echten Ergebnissen der Vorsaison, gemischt mit den alten Werten (je mehr Rennen, desto mehr zählt die Messung).
export function buildNextBase(season, prevCards, prevRR, roster) {
  const rm = rosterMatch(roster), st = computeStats(prevRR || {}, roster), out = {};
  for (const c of Object.values(prevCards).filter(x => x.season === season - 1)) {
    const nc = { ...c, key: c.key.replace(`:S${season - 1}:`, `:S${season}:`), season };
    if (c.kind === 'driver') {
      const d = c.src.startsWith('h:') ? rm.human(c.src.slice(2)) : rm.ai(c.src.slice(2));
      nc.rosterName = d ? d.name : null; if (d) { nc.team = d.team || nc.team; nc.photo = d.photo || nc.photo || ''; }
      const s = d && st[d.name];
      if (s && s.n > 0) {
        const w = s.n / (s.n + BLEND_K), stats = {};
        for (const k of STAT_KEYS) stats[k] = clamp(Math.round(c.stats[k] + ((58 + (s[k] - 40) * 27 / 59) - c.stats[k]) * w), 40, 92); // 40..99 -> 58..85
        nc.stats = stats; nc.ges = gesOf(stats);
      }
      nc.badges = (c.badges || []).filter(b => b !== 'Saison-1-Rookie');
    }
    out[nc.key] = finish(nc);
  }
  return out;
}

// ---------------------------------------------------------------- Inform-Karten (eine pro Fahrer und Rennen)
export function makeInforms(RR, cards, roster, season, countryOf, existing = {}) {
  const out = { ...existing }, now = Date.now(), byRoster = {};
  Object.values(cards).filter(c => c.season === season && c.kind === 'driver' && c.rosterName).forEach(c => { byRoster[c.rosterName] = c; });
  const nums = Object.keys(RR || {}).map(Number).filter(n => RR[n] && Object.keys(RR[n]).length).sort((a, b) => a - b);
  for (const n of nums) {
    const res = RR[n], where = countryOf(n), has = d => res[d.name] && String(res[d.name].pos ?? '').trim() !== '';
    const inRace = roster.filter(has); if (inRace.length < 4) continue;
    const why = {}, add = (d, label, b) => { (why[d.name] = why[d.name] || []).push({ label, b }); };
    const posOf = d => parseInt(String(res[d.name].pos).trim(), 10);
    const win = inRace.filter(d => posOf(d) === 1); if (win.length === 1) add(win[0], 'Sieger', INFORM_BOOST.win);
    inRace.filter(d => posOf(d) === 2 || posOf(d) === 3).forEach(d => add(d, 'Podium', INFORM_BOOST.podium));
    const fl = inRace.filter(d => res[d.name].fastestLap === true); if (fl.length === 1) add(fl[0], 'Schnellste Runde', INFORM_BOOST.fl);
    const gaps = inRace.map(d => ({ d, g: parseFloat(String(res[d.name].qualGap ?? '').replace(',', '.')) })).filter(x => Number.isFinite(x.g)).sort((x, y) => x.g - y.g);
    if (gaps.length >= 4 && gaps[0].g <= 0.0005 && gaps[0].g < gaps[1].g) add(gaps[0].d, 'Pole', INFORM_BOOST.pole);
    const qr = {}; gaps.forEach((x, i) => qr[x.d.name] = i + 1);
    const gain = inRace.map(d => (Number.isFinite(posOf(d)) && qr[d.name] ? { d, v: qr[d.name] - posOf(d) } : null)).filter(Boolean).sort((x, y) => y.v - x.v);
    if (gain.length > 1 && gain[0].v >= 3 && gain[0].v > gain[1].v) add(gain[0].d, 'Aufholjagd', INFORM_BOOST.form);
    for (const [rn, rs] of Object.entries(why)) {
      const base = byRoster[rn]; if (!base) continue;
      const id = `s${season}-r${n}-${base.id}`; if (out[id]) continue; // einmal erstellt, bleibt eingefroren
      const boost = Math.min(5, Math.max(...rs.map(x => x.b)) + rs.length - 1), stats = {};
      for (const k of STAT_KEYS) stats[k] = Math.min(99, base.stats[k] + boost);
      out[id] = { id, kind: 'special', season, race: n, driverKey: base.key, name: base.name, short: base.short, human: base.human, team: base.team || '', photo: base.photo || '',
        title: rs.slice(0, 2).map(x => x.label).join(' + ') + (rs.length > 2 ? ' +' : '') + ` · ${where}`, reasons: rs.map(x => x.label), boost, stats, ges: gesOf(stats), rarity: 'X', ts: now };
    }
  }
  return out;
}

// ---------------------------------------------------------------- Pool und Ziehung
// Nur die Karten der aktuellen Saison, Spezialkarten nur aus den letzten 3 Rennen
export function buildPool(defs, season, maxRace) {
  const byRarity = { B: [], S: [], G: [] };
  Object.values(defs.cards || {}).filter(c => c.season === season).forEach(c => byRarity[c.rarity].push({ key: c.key, weight: c.weight }));
  const specials = Object.values(defs.specials || {}).filter(s => s.season === season && s.race >= maxRace - 2).map(s => ({ key: 'special:' + s.id, weight: 1 }));
  return { byRarity, specials };
}
export function pAtLeast(packKey, minTier) {
  const { n, p } = PACKS[packKey], q = p.slice(TIERS.indexOf(minTier)).reduce((a, b) => a + b, 0);
  return 1 - (1 - q) ** n;
}
export const secureRng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
function pickWeighted(items, rng) {
  const total = items.reduce((t, x) => t + x.weight, 0);
  let r = rng() * total;
  for (const x of items) { r -= x.weight; if (r < 0) return x; }
  return items[items.length - 1];
}
// Gibt Kartenschlüssel zurück: "driver:S1:H_Timo", "team:S1:Ferrari", "track:S1:ITA", "special:s1-r7-A_verstappen"
export function rollPack(packKey, pool, rng = secureRng) {
  const { n, p } = PACKS[packKey], out = [];
  for (let i = 0; i < n; i++) {
    let tier = 'B', r = rng();
    for (let t = 0; t < p.length; t++) { if (r < p[t]) { tier = TIERS[t]; break; } r -= p[t]; }
    if (tier === 'X' && pool.specials.length) { out.push(pickWeighted(pool.specials, rng).key); continue; }
    if (tier === 'X') tier = 'G'; // Notausgang, der Server verhindert den Spezial-Kauf ohne aktive Spezialkarten
    out.push(pickWeighted(pool.byRarity[tier].length ? pool.byRarity[tier] : pool.byRarity.S, rng).key);
  }
  return out;
}

// ---------------------------------------------------------------- Stats aus echten Ergebnissen (ab Saison 2)
const pp = e => { const p = e && e.pos != null ? String(e.pos).trim() : ''; return /^\d+$/.test(p) ? +p : null; };
const hasPos = e => !!e && e.pos != null && String(e.pos).trim() !== '';
const qgap = e => { const q = e && e.qualGap != null ? String(e.qualGap).trim() : ''; if (!q) return null; if (/^(dnf|dsq|dns)$/i.test(q)) return 'dnf'; const g = parseFloat(q.replace(',', '.')); return isNaN(g) ? null : g; };
const mean = a => a.reduce((t, v) => t + v, 0) / a.length;
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };

// RR = raceResults ({raceNum: {fahrerName: {pos, qualGap, fastestLap}}}), roster = driverRoster.
// Rückgabe: { fahrerName: { tmp, pac, con, ang, rel, ges, n } }, Werte 40..99, neutral 60 (n = Anzahl Rennen)
export function computeStats(RR, roster, penFor = () => 0) {
  const acc = {}; roster.forEach(d => acc[d.name] = { qs: [], rs: [], ang: [], dnf: 0, pen: 0, n: 0 });
  for (const num of Object.keys(RR || {})) {
    const res = RR[num] || {}, en = roster.filter(d => hasPos(res[d.name]));
    const N = en.length; if (N < 2) continue;
    const gaps = en.map(d => ({ d, g: qgap(res[d.name]) }));
    const valid = gaps.filter(x => typeof x.g === 'number'), maxG = Math.max(0, ...valid.map(x => x.g));
    const qRank = {}; [...valid].sort((a, b) => a.g - b.g).forEach((x, i) => qRank[x.d.name] = i + 1);
    for (const { d, g } of gaps) {
      const a = acc[d.name], p = pp(res[d.name]); a.n++;
      if (g === 'dnf') a.qs.push(0); else if (typeof g === 'number') a.qs.push(maxG > 0 ? 1 - g / maxG : 1);
      if (p === null) a.dnf++; else { a.rs.push(1 - (p - 1) / (N - 1)); if (qRank[d.name]) a.ang.push(qRank[d.name] - p); }
      if (penFor(num, d.name) > 0) a.pen++;
    }
  }
  const raw = {};
  for (const [name, a] of Object.entries(acc)) raw[name] = {
    tmp: a.qs.length ? [mean(a.qs), a.qs.length] : null,
    pac: a.rs.length ? [mean(a.rs), a.rs.length] : null,
    con: a.rs.length ? [mean(a.rs) - sd(a.rs), a.rs.length] : null,   // "Boden": hohes Niveau UND wenig Schwankung
    ang: a.ang.length ? [mean(a.ang), a.ang.length] : null,
    rel: a.n ? [1 - (a.dnf + 0.5 * a.pen) / a.n, a.n] : null,
  };
  const out = {}; roster.forEach(d => out[d.name] = { n: acc[d.name].n });
  for (const k of STAT_KEYS) {
    const have = roster.filter(d => raw[d.name][k]).map(d => raw[d.name][k][0]);
    for (const d of roster) {
      const r = raw[d.name][k];
      if (!r) { out[d.name][k] = 60; continue; }
      const below = have.filter(v => v < r[0]).length, same = have.filter(v => v === r[0]).length;
      const pct = have.length > 1 ? (below + (same - 1) / 2) / (have.length - 1) : 0.5;
      out[d.name][k] = Math.round(60 + (40 + 59 * pct - 60) * r[1] / (r[1] + SHRINK_K));
    }
  }
  for (const d of roster) out[d.name].ges = gesOf(out[d.name]);
  return out;
}
