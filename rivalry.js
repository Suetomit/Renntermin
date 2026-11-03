// Rivalitäten- und Ansehen-Logik, gemeinsam genutzt von index_v2.html und admin.html.
// Das sportliche Elo wird hier NICHT berührt.
export const pp = e => { const p = e && e.pos != null ? String(e.pos).trim() : ''; return /^\d+$/.test(p) ? +p : null; };
export const hasPos = e => !!e && e.pos != null && String(e.pos).trim() !== '';
export const qg = e => { const q = e && e.qualGap != null ? String(e.qualGap).trim() : ''; if (!q) return { h: 0 }; if (/^(dnf|dsq|dns)$/i.test(q)) return { h: 1, dnf: 1 }; const g = parseFloat(q.replace(',', '.')); return isNaN(g) ? { h: 0 } : { h: 1, g }; };

export function byIng(roster, n) {
  const c = String(n || '').replace(/^(\[KI\]|_KI_)\s*/, '').trim().toLowerCase();
  return roster.find(d => d.racenet && d.racenet.toLowerCase() === c)
    || roster.find(d => !d.human && d.name.toLowerCase() === c)
    || roster.find(d => !d.human && d.name.toLowerCase().split(' ').pop() === c) || null;
}

// beste Rennrunde und Strafenanzahl je Fahrer aus dem Telemetrie-Archiv eines Rennens
function archByDriver(ctx, num) {
  const a = (ctx.TA || {})[num] || {}, bl = a.bestLaps || {}, pn = a.penalties || {}, m = {};
  new Set([...Object.keys(a.strategies || {}), ...Object.keys(bl), ...Object.keys(pn)]).forEach(k => {
    const i = byIng(ctx.roster, k); if (i) m[i.name] = { best: bl[k], pen: pn[k] || 0 };
  });
  return m;
}

// Duell-Punkte eines Rennwochenendes (max. 4 je Fahrer). null = Rennen zählt nicht (einer war nicht dabei).
export function duelRace(ctx, a, b, num) {
  const res = (ctx.RR || {})[num] || {}, x = res[a], y = res[b];
  if (!hasPos(x) || !hasPos(y)) return null;
  const arch = archByDriver(ctx, num), la = arch[a], lb = arch[b], qa = qg(x), qb = qg(y), fa = pp(x), fb = pp(y);
  const s = [0, 0, 0, 0]; // 1 = Punkt für a, -1 = Punkt für b, 2 = Punkt für beide
  if (qa.h && qb.h && !(qa.dnf && qb.dnf)) s[0] = qa.dnf ? -1 : qb.dnf ? 1 : qa.g < qb.g ? 1 : qa.g > qb.g ? -1 : 0;
  if (la && lb && la.best > 0 && lb.best > 0) s[1] = la.best < lb.best ? 1 : la.best > lb.best ? -1 : 0;
  else s[1] = x.fastestLap === true ? 1 : y.fastestLap === true ? -1 : 0;
  const pa = la ? la.pen : 0, pb = lb ? lb.pen : 0;
  s[2] = pa === pb ? 2 : pa < pb ? 1 : -1;
  s[3] = fa !== null && fb !== null ? (fa < fb ? 1 : -1) : fa !== null ? 1 : fb !== null ? -1 : 0;
  const A = s.map(v => (v === 1 || v === 2 ? 1 : 0)), B = s.map(v => (v === -1 || v === 2 ? 1 : 0));
  return { a: A, b: B, ta: A.reduce((t, v) => t + v, 0), tb: B.reduce((t, v) => t + v, 0) };
}

// Best-of-3 mit Knockout: nach 2 Rennen ab 5 Punkten Vorsprung entschieden (es wären nur noch 4 zu holen).
export function evalRv(ctx, rv) {
  const rows = []; let ta = 0, tb = 0, ko = false;
  for (const r of ctx.races) {
    if (!r.done || r.num < rv.startRace) continue;
    const d = duelRace(ctx, rv.a, rv.b, r.num); if (!d) continue;
    rows.push({ num: r.num, country: r.country, ...d }); ta += d.ta; tb += d.tb;
    if (rows.length === 2 && Math.abs(ta - tb) >= 5) { ko = true; break; }
    if (rows.length >= 3) break;
  }
  const done = ko || rows.length >= 3, winner = done && ta !== tb ? (ta > tb ? rv.a : rv.b) : null;
  return { rows, ta, tb, ko, done, winner, amount: winner ? (ko ? 15 : 10) : 0 };
}
// Abgerechnete Rivalitäten (result) bleiben auch nach dem Saisonwechsel erhalten.
export const rvView = (ctx, rv) => rv.result ? { ...rv.result, rows: rv.result.rows || [], done: true } : evalRv(ctx, rv);

// Ansehen: alle starten bei 100, der Sieger stiehlt 10 (Knockout 15) vom Verlierer.
export function ansehenMap(ctx, RV) {
  const m = {}; ctx.roster.forEach(d => m[d.name] = 100);
  Object.values(RV || {}).forEach(rv => {
    if (['ended', 'queued', 'expired'].includes(rv.status)) return;
    const v = rvView(ctx, rv); if (!v.done || !v.winner) return;
    const l = v.winner === rv.a ? rv.b : rv.a;
    m[v.winner] = (m[v.winner] ?? 100) + v.amount; m[l] = (m[l] ?? 100) - v.amount;
  });
  return m;
}
export const activeCount = (ctx, RV, name) => Object.values(RV || {}).filter(rv => (rv.a === name || rv.b === name) && rv.status === 'active' && !rvView(ctx, rv).done).length;

// Lebenszyklus: beendete Duelle abrechnen, wartende nachrücken lassen, veraltete verfallen lassen.
// Gibt nur die geänderten Rivalitäten zurück ({id: neuesObjekt}), geschrieben wird vom Aufrufer (Admin oder Bot).
export function planSettle(ctx, RV) {
  const W = JSON.parse(JSON.stringify(RV || {})), upd = {};
  const nextOpen = (ctx.races.find(r => !r.done) || { num: ctx.races.length + 1 }).num;
  for (const [id, rv] of Object.entries(W)) {
    if (rv.status !== 'active' || rv.result) continue;
    const v = evalRv(ctx, rv);
    if (v.done) W[id] = upd[id] = { ...rv, status: 'finished', result: { winner: v.winner, ta: v.ta, tb: v.tb, amount: v.amount, ko: v.ko, rows: v.rows } };
  }
  for (const [id, rv] of Object.entries(W).filter(([, r]) => r.status === 'queued').sort((x, y) => x[1].createdAt - y[1].createdAt)) {
    const since = ctx.races.filter(r => r.done && r.num >= (rv.queueRace ?? rv.startRace ?? 0)).length;
    if (since >= 2) { W[id] = upd[id] = { ...rv, status: 'expired' }; continue; } // Warteschlange verfällt nach 2 Rennen
    if (activeCount(ctx, W, rv.a) < 3 && activeCount(ctx, W, rv.b) < 3) W[id] = upd[id] = { ...rv, status: 'active', startRace: nextOpen };
  }
  return upd;
}
