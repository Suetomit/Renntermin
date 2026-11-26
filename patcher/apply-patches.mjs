// Wendet patches.txt auf deine Website-Dateien an. Aufruf im Repo-Ordner:  node apply-patches.mjs [ordner]
// Jede Datei wird nur geändert, wenn ALLE Stellen genau einmal gefunden werden. Vorher entsteht <datei>.bak.
// Ein zweiter Lauf ändert nichts (SKIPIF-Marker). Fehlende Dateien werden übersprungen.
import fs from 'fs'; import path from 'path';
const dir = process.argv[2] || '.', here = path.dirname(new URL(import.meta.url).pathname);
const lines = fs.readFileSync(path.join(here, 'patches.txt'), 'utf8').replace(/\r/g, '').split('\n');
const files = []; let f = null, e = null, mode = null, buf = [];
const flush = () => { if (!mode) return; const t = buf.join('\n'); if (mode === 'FIND') e = { find: t }; else if (mode === 'REPLACE') e.replace = t; buf = []; };
for (const l of lines) {
  if (l.startsWith('@@FILE ')) { flush(); mode = null; f = { name: l.slice(7).trim(), skip: null, edits: [] }; files.push(f); }
  else if (l.startsWith('@@SKIPIF ')) f.skip = l.slice(9);
  else if (l === '@@FIND') { flush(); mode = 'FIND'; }
  else if (l === '@@REPLACE') { flush(); mode = 'REPLACE'; }
  else if (l === '@@END') { flush(); f.edits.push(e); mode = null; }
  else if (mode) buf.push(l);
}
let bad = 0;
for (const spec of files) {
  const p = path.join(dir, spec.name);
  if (!fs.existsSync(p)) { console.log(`-  ${spec.name}: nicht gefunden, übersprungen`); continue; }
  let s = fs.readFileSync(p, 'utf8'); const crlf = s.includes('\r\n'); if (crlf) s = s.replace(/\r\n/g, '\n');
  if (spec.skip && s.includes(spec.skip)) { console.log(`=  ${spec.name}: schon gepatcht`); continue; }
  let ok = true;
  for (const [i, ed] of spec.edits.entries()) {
    const n = s.split(ed.find).length - 1;
    if (n !== 1) { console.log(`!! ${spec.name}: Stelle ${i + 1} ${n === 0 ? 'nicht gefunden' : 'mehrfach gefunden'}: ${ed.find.slice(0, 70)}`); ok = false; break; }
    s = s.replace(ed.find, () => ed.replace);
  }
  if (!ok) { bad++; console.log(`   ${spec.name} bleibt unverändert.`); continue; }
  fs.copyFileSync(p, p + '.bak'); fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log(`OK ${spec.name}: ${spec.edits.length} Änderungen (Sicherung: ${spec.name}.bak)`);
}
process.exit(bad ? 1 : 0);
