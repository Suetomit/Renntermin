// Gurkensöhne Cup - Kartenkern (reine Funktionen, keine Datenbank).
// Wird später vom Worker (Packs ziehen) und vom Bot (Stats berechnen) importiert.
// Ziehung IMMER im Worker mit crypto-Zufall, nie im Browser.

// ---------------------------------------------------------------- Konfiguration
export const TIERS = ['B', 'S', 'G', 'X']; // Bronze, Silber, Gold, Spezial
export const PACKS = {
  //            Karten, Preis, Wahrscheinlichkeit PRO KARTE für B / S / G / X
  bronze:  { n: 3, price: 100, p: [0.80, 0.17, 0.027, 0.003] },
  silber:  { n: 4, price: 250, p: [0.45, 0.42, 0.115, 0.015] },
  gold:    { n: 5, price: 600, p: [0.15, 0.45, 0.360, 0.040] },
  spezial: { n: 3, price: 900, p: [0.03, 0.17, 0.450, 0.350] },
};
export const QUICKSELL = { B: 4, S: 12, G: 40, X: 120 };          // Duplikat einschmelzen (ca. 20 % vom Packpreis)
export const EDITION_BONUS = { B: 0, S: 3, G: 6 };                 // Aufschlag auf alle 5 Stats (Anzeige)
export const KIND_SHARE = { driver: 0.5, track: 0.3, team: 0.2 };  // Anteil der Basiskarten-Ziehungen
export const DRIVER_WEIGHT = { human: 1.0, ai: 1.5 };              // KI-Karten sind etwas häufiger
export const STAT_WEIGHTS = { pac: 0.30, tmp: 0.25, con: 0.15, ang: 0.15, rel: 0.15 };
const SHRINK_K = 2; // so viele Rennen zählen, bevor die Messung so viel wiegt wie der neutrale Startwert 60

// "Chance auf mindestens 1 Karte der Stufe minTier oder besser", wie bei EA FC angezeigt
export function pAtLeast(packKey, minTier) {
  const { n, p } = PACKS[packKey], q = p.slice(TIERS.indexOf(minTier)).reduce((a, b) => a + b, 0);
  return 1 - (1 - q) ** n;
}

// ---------------------------------------------------------------- Zufall
export const secureRng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
function pickWeighted(items, weightOf, rng) {
  const total = items.reduce((t, x) => t + weightOf(x), 0);
  let r = rng() * total;
  for (const x of items) { r -= weightOf(x); if (r < 0) return x; }
  return items[items.length - 1];
}

// pool = { base: { driver:[{id,human}], team:[{id}], track:[{id}] }, specials: [{id, weight}] }
// Gibt Kartenschlüssel zurück, z.B. "driver:Marcel Walle:G", "track:ITA:S", "special:r07-sieger-marcel"
export function rollPack(packKey, pool, rng = secureRng) {
  const { n, p } = PACKS[packKey], out = [];
  for (let i = 0; i < n; i++) {
    let tier = TIERS[0], r = rng();
    for (let t = 0; t < p.length; t++) { if (r < p[t]) { tier = TIERS[t]; break; } r -= p[t]; }
    if (tier === 'X' && pool.specials.length) { out.push('special:' + pickWeighted(pool.specials, s => s.weight || 1, rng).id); continue; }
    if (tier === 'X') tier = 'G'; // Notausgang: gerade keine Spezialkarte aktiv
    const kind = pickWeighted(Object.keys(KIND_SHARE), k => KIND_SHARE[k], rng);
    const card = pickWeighted(pool.base[kind], c => (kind === 'driver' ? (c.human ? DRIVER_WEIGHT.human : DRIVER_WEIGHT.ai) : 1), rng);
    out.push(`${kind}:${card.id}:${tier}`);
  }
  return out;
}

// ---------------------------------------------------------------- Stats
const pp = e => { const p = e && e.pos != null ? String(e.pos).trim() : ''; return /^\d+$/.test(p) ? +p : null; };
const hasPos = e => !!e && e.pos != null && String(e.pos).trim() !== '';
const qgap = e => { const q = e && e.qualGap != null ? String(e.qualGap).trim() : ''; if (!q) return null; if (/^(dnf|dsq|dns)$/i.test(q)) return 'dnf'; const g = parseFloat(q.replace(',', '.')); return isNaN(g) ? null : g; };
const mean = a => a.reduce((t, v) => t + v, 0) / a.length;
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };

// RR = raceResults ({raceNum: {fahrerName: {pos, qualGap, fastestLap}}}), roster = driverRoster,
// penFor(raceNum, fahrerName) = Anzahl Strafen aus telemetryArchive (Aufrufer löst Ingame-Namen auf, z.B. mit RL.byIng)
// Rückgabe: { fahrerName: { tmp, pac, con, ang, rel, ges, n } }, Werte 40..99, neutral 60
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
      if (p === null) a.dnf++; else {
        a.rs.push(1 - (p - 1) / (N - 1));
        if (qRank[d.name]) a.ang.push(qRank[d.name] - p);
      }
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
  for (const k of Object.keys(STAT_WEIGHTS)) {
    const have = roster.filter(d => raw[d.name][k]).map(d => ({ n: d.name, v: raw[d.name][k][0] }));
    for (const d of roster) {
      const r = raw[d.name][k];
      if (!r) { out[d.name][k] = 60; continue; }
      const below = have.filter(x => x.v < r[0]).length, same = have.filter(x => x.v === r[0]).length;
      const pct = have.length > 1 ? (below + (same - 1) / 2) / (have.length - 1) : 0.5; // Perzentil, Gleichstände gemittelt
      const stat = 40 + 59 * pct;
      out[d.name][k] = Math.round(60 + (stat - 60) * r[1] / (r[1] + SHRINK_K));
    }
  }
  for (const d of roster) out[d.name].ges = Math.round(Object.entries(STAT_WEIGHTS).reduce((t, [k, w]) => t + w * out[d.name][k], 0));
  return out;
}
