// Racenet-CSV-Import für admin.html (Gurkensöhne Cup).
// Liest die Racenet-Exporte (Ergebnisse + Qualifying), zeigt eine Vorschau und schreibt erst nach Bestätigung.
// Geschrieben werden:
//  - telemetryArchive/<Nr>/bestLaps, fastestLap, lapSource (und penalties sowie raceNumber/completedAt/source,
//    falls für das Rennen noch gar kein Archiv existiert). Strategien und Boxenstopps bleiben unberührt.
//  - optional (Haken im Tab): raceResults/<Nr>/<Fahrer> mit Platz, Quali-Abstand und ⚡. Nur geänderte Einträge.
// DNF-Regel: Wer weniger Rennzeit hat als der Sieger, ist ausgefallen (in den 5 Test-Rennen trennt das sauber).

const TRACKS = {
  'australia': 'AUS', 'china': 'CHN', 'japan': 'JPN', 'bahrain': 'BHR', 'saudi arabia': 'SAU', 'miami': 'MIA',
  'imola': 'IMO', 'emilia romagna': 'IMO', 'emilia-romagna': 'IMO', 'monaco': 'MCO', 'spain': 'ESP', 'canada': 'CAN',
  'austria': 'AUT', 'great britain': 'GBR', 'united kingdom': 'GBR', 'belgium': 'BEL', 'hungary': 'HUN',
  'netherlands': 'NLD', 'italy': 'ITA', 'azerbaijan': 'AZE', 'singapore': 'SGP', 'usa': 'USA', 'united states': 'USA',
  'austin': 'USA', 'mexico': 'MEX', 'brazil': 'BRA', 'las vegas': 'VGS', 'qatar': 'QAT', 'abu dhabi': 'UAE',
};

const secs = s => { const m = /^(\d+):(\d+):([\d.]+)$/.exec(String(s || '').trim()); return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0; };
const lap3 = s => { const v = secs(s); return v > 0 ? +v.toFixed(3) : 0; };
const fmtLap = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const safe = k => String(k).replace(/[.#$\[\]\/]/g, '_');
const parse = txt => {
  const L = txt.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!L.length) return [];
  const H = L[0].split(',').map(h => h.trim());
  return L.slice(1).map(l => { const c = l.split(','), o = {}; H.forEach((h, i) => o[h] = (c[i] || '').trim()); return o; });
};

// Zuordnung Racenet-Name -> Fahrer: erst das Feld "Racenet-Name" (racenetName), sonst wie auf der Website (Ingame-Name, KI-Name).
const findDriver = (roster, n, RL) => {
  const c = String(n || '').trim().toLowerCase();
  return roster.find(d => d.racenetName && String(d.racenetName).trim().toLowerCase() === c) || RL.byIng(roster, n);
};

// Reine Auswertung eines Rennens (ohne Datenbankzugriff, damit sie sich testen lässt).
export function analyseBatch(b, C, RL) {
  const A = { laps: {}, pens: {}, humans: [], dnfs: [], unknown: [], zero: [], noQuali: [], fastest: null, warn: [], diffs: [], results: {}, changes: 0 };
  const ql = {};
  b.qual.forEach(q => { const v = secs(q.QualifyingTime); if (v > 0) ql[q.PlayerName] = v; });
  const pole = Math.min(...Object.values(ql), Infinity);
  const cur = (C.RR || {})[b.num] || {};
  const rows = [...b.res].sort((x, y) => +x.Position - +y.Position);
  const winT = rows.length ? secs(rows[0].Time) : 0;
  const isDnf = r => winT > 0 && +r.Position > 1 && secs(r.Time) > 0 && secs(r.Time) < winT - 0.001;
  const lastFin = Math.max(0, ...rows.filter(r => !isDnf(r)).map(r => +r.Position)), firstDnf = Math.min(Infinity, ...rows.filter(isDnf).map(r => +r.Position));
  if (lastFin > firstDnf) A.warn.push('DNF-Erkennung unsicher (Platzierungen und Rennzeiten passen nicht zusammen). Bitte Ergebnisse prüfen.');
  let best = null, flag = null; const seen = [];
  rows.forEach(r => {
    const d = findDriver(C.roster, r.PlayerName, RL), t = lap3(r.FastestLap), ai = r.IsAi === 'True';
    if (!d) { A.unknown.push(r.PlayerName); return; }
    const nm = ai ? r.PlayerName : (d.racenet || r.PlayerName); // Menschen unter ihrem Ingame-Namen speichern, damit Website und Rivalität sie wie bisher finden
    const key = safe((ai ? '_KI_ ' : '') + nm); // gleiche Schreibweise wie das Telemetrie-Skript
    A.pens[key] = +r.Penalty > 0 ? 1 : 0;
    const dnf = isDnf(r), q = ql[r.PlayerName], e = cur[d.name] || {};
    if (t > 0) {
      A.laps[key] = t;
      const rec = { t, d, name: ai ? '[KI] ' + nm : nm };
      if (!best || t < best.t) best = rec;
      if (r.HasFastestLap === 'True') flag = rec;
      if (d.human) A.humans.push(`${d.human} ${fmtLap(t)}`);
    } else A.zero.push(d.human || d.name);
    if (dnf && d.human) A.dnfs.push(d.human);
    let qualGap = e.qualGap != null ? String(e.qualGap) : '';
    if (q && isFinite(pole)) qualGap = (q - pole).toFixed(3); else if (d.human) A.noQuali.push(d.human);
    A.results[d.name] = { pos: dnf ? 'DNF' : String(+r.Position), qualGap, fastestLap: false, human: d.human };
    seen.push(d.name);
  });
  if (flag && best && flag.t !== best.t) { A.warn.push('Racenet-Markierung ⚡ und kleinste Zeit passen nicht zusammen. Es zählt die kleinste Zeit.'); flag = null; }
  const f = flag || best;
  if (f) { A.fastest = { driver: f.name, lap_time_s: f.t, show: f.d.human || f.d.name }; if (A.results[f.d.name]) A.results[f.d.name].fastestLap = true; }

  // Vergleich mit den bisher eingetragenen Ergebnissen: nur geänderte Einträge werden später geschrieben
  A.writes = {};
  const lab = n => (C.roster.find(d => d.name === n) || {}).human;
  Object.entries(A.results).forEach(([n, x]) => {
    const e = cur[n], h = x.human, o = { pos: x.pos, qualGap: x.qualGap, fastestLap: x.fastestLap };
    const g = RL.qg(e), ng = RL.qg({ qualGap: x.qualGap });
    const samePos = e && String(e.pos ?? '').trim().toUpperCase() === x.pos.toUpperCase();
    const sameQ = e && ((!g.h && !ng.h) || (g.h && ng.h && (g.dnf ? !!ng.dnf : !ng.dnf && Math.abs(g.g - ng.g) <= 0.0015)));
    const sameF = e && !!e.fastestLap === x.fastestLap;
    if (!e || !samePos || !sameQ || !sameF) { A.writes[n] = o; A.changes++; }
    if (h) {
      if (!e || !RL.hasPos(e)) A.diffs.push(`${h}: noch kein Ergebnis (Racenet: ${x.pos === 'DNF' ? 'DNF' : 'P' + x.pos})`);
      else if (!samePos) A.diffs.push(`${h}: Platz ${e.pos} eingetragen, Racenet ${x.pos === 'DNF' ? 'DNF' : 'P' + x.pos}`);
      if (e && RL.hasPos(e) && !sameQ) A.diffs.push(`${h}: Quali ${g.h ? (g.dnf ? 'DNF' : '+' + g.g) : 'leer'} eingetragen, Racenet ${ng.h ? '+' + ng.g.toFixed(3) : 'leer'}`);
    }
  });
  // Altes ⚡ bei einem anderen Fahrer muss weg, sonst gäbe es zwei
  Object.entries(cur).forEach(([n, e]) => {
    if (e && e.fastestLap === true && !(A.results[n] && A.results[n].fastestLap)) {
      A.writes[n] = { ...(A.writes[n] || { pos: e.pos ?? '', qualGap: e.qualGap ?? '' }), fastestLap: false };
      A.diffs.push(`⚡ bisher bei ${lab(n) || n}, Racenet: ${A.fastest ? A.fastest.show : '-'}`);
    }
  });
  A.changes = Object.keys(A.writes).length;
  return A;
}

export function setupRacenet({ db, ref, set, RL, ctx, render }) {
  let B = [], note = '', busy = false, applyRes = true;
  const C = () => ({ ...ctx(), RL });
  const an = b => analyseBatch(b, C(), RL);

  async function load(files) {
    const g = {};
    for (const f of files) {
      const m = /event_(\d+)/.exec(f.name), rows = parse(await f.text());
      if (!rows.length) continue;
      // Qualifying/Ergebnis an den Spalten erkennen (nicht am Dateinamen), Gruppierung per Event-Nr. oder Streckenname
      const isQ = 'QualifyingTime' in rows[0], id = m ? m[1] : (rows[0].TrackName || f.name);
      const o = g[id] = g[id] || { id, track: '', res: [], qual: [] };
      o.track = rows[0].TrackName || o.track;
      if (isQ) o.qual = rows.filter(r => r.PlayerName);
      else o.res = rows.filter(r => r.PlayerName && 'FastestLap' in r);
    }
    const all = Object.values(g), ok = all.filter(o => o.res.length);
    ok.forEach(o => { const r = ctx().races.find(x => x.code === TRACKS[o.track.toLowerCase()]); o.num = r ? r.num : null; });
    B = ok.sort((a, b) => (a.num || 99) - (b.num || 99));
    note = all.length > ok.length ? `${all.length - ok.length} Event(s) ohne Ergebnis-Datei wurden ignoriert.` : '';
  }

  async function importAll() {
    const todo = B.filter(b => b.num);
    if (!todo.length || busy) return;
    if (todo.some(b => an(b).unknown.length)) { note = 'Import gestoppt: Im Fahrer-Tab fehlen Racenet-Namen (siehe rote Hinweise). Sonst wäre die schnellste Runde falsch.'; render(); return; }
    const nCh = todo.reduce((t, b) => t + an(b).changes, 0);
    if (!confirm(`${todo.length} Rennen importieren?\nBestzeiten und schnellste Runde im Archiv werden ersetzt.` + (applyRes ? `\n${nCh} Einträge in den Rennergebnissen werden geändert (Platz, Quali, ⚡).` : ''))) return;
    busy = true; note = ''; render();
    try {
      const TA = ctx().TA || {};
      for (const b of todo) {
        const A = an(b), base = 'telemetryArchive/' + b.num, ex = TA[b.num];
        await set(ref(db, base + '/bestLaps'), Object.keys(A.laps).length ? A.laps : null);
        await set(ref(db, base + '/fastestLap'), A.fastest ? { driver: A.fastest.driver, lap_time_s: A.fastest.lap_time_s } : null);
        await set(ref(db, base + '/lapSource'), 'racenet');
        if (!ex) {
          await set(ref(db, base + '/raceNumber'), b.num);
          await set(ref(db, base + '/completedAt'), Date.now());
          await set(ref(db, base + '/source'), 'racenet');
        }
        if (!ex || !ex.penalties) await set(ref(db, base + '/penalties'), A.pens);
        if (applyRes) for (const [n, o] of Object.entries(A.writes)) await set(ref(db, `raceResults/${b.num}/${n}`), o);
      }
      note = `${todo.length} Rennen importiert ✓`; B = [];
    } catch (e) { console.error(e); note = 'Fehler: ' + (e.code === 'PERMISSION_DENIED' ? 'keine Berechtigung (Login prüfen)' : e.message); }
    busy = false; render();
  }

  function card(b, i, c) {
    const A = an(b), ex = (c.TA || {})[b.num];
    const opts = '<option value="">Rennen wählen</option>' + c.races.map(r => `<option value="${r.num}" ${r.num === b.num ? 'selected' : ''}>#${r.num} ${esc(r.country)} (${esc(r.city)})</option>`).join('');
    const bad = t => `<div class="sub" style="color:var(--bad);margin-top:6px">${t}</div>`;
    const exTxt = !b.num ? '' : ex
      ? `Archiv vorhanden${ex.fastestLap ? `, bisher ⚡ ${esc(ex.fastestLap.driver)}` : ''}. Strategien bleiben erhalten.`
      : 'Noch kein Archiv, es wird neu angelegt.';
    return `<div class="card"><h2>${esc(b.track)} <span class="sub">Event ${esc(b.id)}</span></h2>
      <select class="rn_sel" data-i="${i}">${opts}</select>
      ${b.num ? '' : bad('Strecke nicht erkannt, bitte das Rennen auswählen.')}
      <div class="sub" style="margin-top:8px">${exTxt}</div>
      ${A.fastest ? `<div style="margin-top:8px">⚡ <b>${esc(A.fastest.show)}</b> ${fmtLap(A.fastest.lap_time_s)}</div>` : bad('Keine gültige Rundenzeit gefunden.')}
      <div class="sub" style="margin-top:6px">${A.humans.length ? esc(A.humans.join(' · ')) : 'Keine Zeiten von Menschen.'}</div>
      ${A.dnfs.length ? `<div class="sub" style="margin-top:6px">DNF laut Racenet: ${esc(A.dnfs.join(', '))}</div>` : ''}
      ${A.noQuali.length ? bad('Keine Quali-Zeit bei Racenet (Abstand bleibt wie eingetragen): ' + esc(A.noQuali.join(', '))) : ''}
      ${A.zero.length ? bad('Ohne Zeit (nicht importiert): ' + esc(A.zero.join(', '))) : ''}
      ${A.unknown.length ? bad('Nicht im Fahrer-Tab gefunden (dort das Feld Racenet-Name ausfüllen): ' + esc(A.unknown.join(', '))) : ''}
      ${A.warn.map(bad).join('')}
      ${A.diffs.length ? `<div style="margin-top:8px"><b style="color:var(--gold)">${A.changes} Einträge weichen von deinen Ergebnissen ab:</b>${A.diffs.map(x => `<div class="sub">${esc(x)}</div>`).join('')}</div>` : ''}</div>`;
  }

  function html() {
    const c = C();
    const head = `<div class="card"><h2>Racenet-Import</h2>
      <div class="sub">Alle CSV-Dateien auf einmal wählen (Ergebnisse und Qualifying). Geschrieben wird erst nach deiner Bestätigung. Strategien und Boxenstopps im Archiv bleiben unberührt.</div>
      <input type="file" id="rn_files" accept=".csv,text/csv" multiple style="margin-top:10px">
      <label class="row" style="border:0;margin-top:8px"><input type="checkbox" id="rn_res" ${applyRes ? 'checked' : ''}><span class="grow">Auch Platz, Quali-Abstand und ⚡ in die Rennergebnisse übernehmen</span></label>${note ? `<div class="msg">${esc(note)}</div>` : ''}</div>`;
    if (!B.length) return head;
    const n = B.filter(b => b.num).length;
    return head + B.map((b, i) => card(b, i, c)).join('') +
      `<div class="card"><button class="btn" data-rn="go" ${busy || !n ? 'disabled' : ''}>${busy ? 'Schreibe …' : n + ' Rennen importieren'}</button><button class="btn ghost" data-rn="clear">Liste leeren</button></div>`;
  }

  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'rn_files' && t.files && t.files.length) {
      try { await load([...t.files]); } catch (x) { console.error(x); note = 'CSV nicht lesbar: ' + x.message; }
      render();
    } else if (t.id === 'rn_res') { applyRes = t.checked; render(); }
    else if (t.classList && t.classList.contains('rn_sel')) { B[+t.dataset.i].num = +t.value || null; render(); }
  });
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-rn]'); if (!t) return;
    if (t.dataset.rn === 'clear') { B = []; note = ''; render(); }
    else if (t.dataset.rn === 'go') await importAll();
  });

  return { html };
}
