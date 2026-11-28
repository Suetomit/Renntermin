// Gurkensöhne Cup - Gurken-Lotto Oberfläche (Tab im Gurkengarten). Rechnet nichts selbst, alles kommt vom Worker.
// Einbinden in garden-module.js: siehe Patches im Chat.
const pad = n => String(n).padStart(2, '0');
const fmtCd = ms => {
  if (ms <= 0) return '0 Sek';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return `${d ? d + 'T ' : ''}${d || h ? h + 'Std ' : ''}${m}Min ${pad(s % 60)}Sek`;
};
const fmtDay = id => new Date(id + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
const TIER = { T2: '2 Richtige', T2S: '2 Richtige + Superzahl', T3: '3 Richtige', T3S: '3 Richtige + Superzahl' };
const rndInt = n => { const u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] % n; }; // nur Tipp-Hilfe, die Ziehung passiert im Worker
const chip = (n, hit) => `<span style="display:inline-block;min-width:26px;text-align:center;margin:1px;padding:3px 5px;border-radius:50%;font-weight:800;font-size:.8rem;${hit ? 'background:var(--y);color:#1a1400;' : 'background:var(--bg);'}">${n}</span>`;

export function createLotto({ S, api, apiQuiet, render, esc }) {
  const L = { data: null, picks: [], sz: null, last: 0, fetching: false, skew: 0 };

  async function refresh() {
    if (!S.login || L.fetching) return;
    L.fetching = true; L.last = Date.now();
    const j = await apiQuiet('lotto', { action: 'status' });
    L.fetching = false;
    if (j) { L.data = j; L.skew = j.now - Date.now(); render(); }
  }

  // Countdown tickt ohne Neuzeichnen; läuft er ab, wird der Status neu geholt (löst bei Bedarf die Ziehung aus)
  setInterval(() => {
    const el = document.getElementById('lottoCd'); if (!el) return;
    const left = +el.dataset.t - (Date.now() + L.skew);
    el.textContent = fmtCd(left);
    if (left <= 0 && Date.now() - L.last > 5000) refresh();
  }, 1000);

  function html() {
    if (!S.login) return '<div style="color:var(--m);font-size:.85rem;">Melde dich an, um beim Gurken-Lotto mitzuspielen.</div>';
    if (!L.fetching && Date.now() - L.last > 60000) setTimeout(refresh, 0); // Polling alle 60 s, solange der Tab offen ist
    const D = L.data;
    if (!D) return '<div style="color:var(--m);font-size:.85rem;">Das Lotto wird geladen ...</div>';
    const r = D.round, c = D.cfg, me = S.login.name, left = D.mine.length;
    const full = left >= c.maxTickets, can = r.open && !full && !S.pending;
    const ready = L.picks.length === c.picks && L.sz && can && D.points >= c.price;
    const grid = Array.from({ length: c.pool }, (_, i) => i + 1).map(n =>
      `<button class="mini" style="padding:12px 0;font-size:1rem;${L.picks.includes(n) ? 'background:var(--y);color:#1a1400;border-color:var(--y);' : ''}" data-act="lt_n" data-v="${n}">${n}</button>`).join('');
    const szs = Array.from({ length: c.szMax }, (_, i) => i + 1).map(n =>
      `<button class="mini" style="padding:10px 0;${L.sz === n ? 'background:#27f4d2;color:#06201b;border-color:#27f4d2;' : ''}" data-act="lt_s" data-v="${n}">🥒 ${n}</button>`).join('');
    const hist = D.history.map(h => {
      const my = (h.tickets || []).filter(t => t.d === me), won = my.reduce((a, t) => a + (t.win || 0), 0);
      return `<div class="slot-card"><div style="font-size:.72rem;color:var(--m);">${esc(fmtDay(h.id))} · ${h.count} Schein${h.count === 1 ? '' : 'e'} · Jackpot ${h.pot}</div>
        <div style="margin:4px 0;">${h.nums.map(n => chip(n, false)).join('')} <span style="color:#27f4d2;font-weight:800;">+ 🥒 ${h.sz}</span></div>
        ${h.jackpotHit ? `<div class="note gold" style="margin:4px 0;">🎰 Jackpot geknackt: ${esc([...new Set(h.tickets.filter(t => c.jackpotTiers.includes(t.tier) && t.win).map(t => t.d))].join(' & '))} (${h.jpTotal} Punkte)</div>` : ''}
        ${my.length ? my.map(t => `<div style="font-size:.78rem;">Dein Schein ${t.n.map(n => chip(n, h.nums.includes(n))).join('')} 🥒${t.s}: ${t.tier ? `<b>${TIER[t.tier]}</b> → +${t.win}` : 'leider nichts'}</div>`).join('') + (won ? `<div style="font-size:.78rem;color:var(--y);margin-top:2px;">Gewinn insgesamt: +${won}</div>` : '') : '<div style="font-size:.75rem;color:var(--m);">Du hast nicht mitgespielt.</div>'}</div>`;
    }).join('');
    const players = Object.entries(D.counts).filter(([, n]) => n > 0).map(([n, k]) => `${esc(n)} (${k})`).join(', ');

    return `<div class="slot-card" style="margin-top:0;text-align:center;">
        <div style="font-size:.75rem;color:var(--m);">Jackpot für ${esc(fmtDay(r.id))}</div>
        <div style="font:800 2.4rem var(--hd);color:var(--y);">🥒 ${D.jackpot}</div>
        <div style="font-size:.78rem;color:var(--m);">${D.tickets} Schein${D.tickets === 1 ? '' : 'e'} im Topf${players ? ': ' + players : ''}</div>
        <div style="margin-top:8px;font-size:.85rem;">${r.open ? 'Annahmeschluss in' : 'Annahmeschluss vorbei, Ziehung in'} <b id="lottoCd" data-t="${r.open ? r.closeAt : r.drawAt}" style="color:var(--y);"></b></div>
        <div style="font-size:.7rem;color:var(--m);">Annahmeschluss Sonntag 17:55 Uhr, Ziehung 19:00 Uhr</div></div>
      ${r.open ? `
      <div style="font-weight:700;margin:12px 0 6px;">Deine Zahlen: ${c.picks} aus ${c.pool}</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;">${grid}</div>
      <div style="font-weight:700;margin:12px 0 6px;">Gurken-Superzahl (1 bis ${c.szMax})</div>
      <div style="display:grid;grid-template-columns:repeat(${c.szMax},1fr);gap:6px;">${szs}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;">
        <button class="btn ghost" style="margin-top:0;" data-act="lt_rand">🎲 Zufall einsetzen</button>
        <button class="btn ghost" style="margin-top:0;" data-act="lt_clear">Leeren</button></div>
      <button class="btn" ${ready ? '' : 'disabled'} data-act="lt_buy">${S.pending === 'lotto' ? '...' : full ? `Maximal ${c.maxTickets} Scheine erreicht` : D.points < c.price ? `Zu wenig Punkte (${c.price} nötig)` : `Schein abgeben (${c.price} Punkte)`}</button>
      <button class="btn ghost" ${can && D.points >= c.price ? '' : 'disabled'} data-act="lt_quick">⚡ Quick-Tipp sofort kaufen</button>`
      : '<div class="note gold" style="margin-top:12px;">Die Scheine für diese Woche sind geschlossen. Nach der Ziehung um 19:00 Uhr startet die nächste Runde.</div>'}
      <div style="font-weight:700;margin:16px 0 6px;">🎟️ Deine Scheine diese Woche (${left}/${c.maxTickets})</div>
      ${left ? D.mine.map(t => `<div style="font-size:.85rem;margin-bottom:3px;">${t.n.map(n => chip(n, false)).join('')} <span style="color:#27f4d2;font-weight:800;">+ 🥒 ${t.s}</span></div>`).join('') : '<div style="color:var(--m);font-size:.85rem;">Noch kein Schein abgegeben. Die Tipps der anderen sind bis zur Ziehung geheim, sichtbar ist nur die Anzahl.</div>'}
      <details class="pn" style="margin-top:12px;"><summary>Gewinnstufen</summary><div style="font-size:.8rem;line-height:1.6;margin-top:6px;">
        2 Richtige: Einsatz zurück (${c.prizes.T2})<br>2 Richtige + Superzahl: ${c.prizes.T2S}<br>${c.jackpotTiers.includes('T3') ? '3 Richtige: Jackpot (geteilt)' : `3 Richtige: ${c.prizes.T3}`}<br>3 Richtige + Superzahl: <b>Jackpot</b>, bei mehreren Gewinnern geteilt<br>
        Nach einem Jackpot-Treffer startet der Topf wieder bei ${c.startPot}. Jeder Schein füttert den Topf mit 17 von ${c.price} Punkten.</div></details>
      <div style="font-weight:700;margin:16px 0 6px;">📜 Letzte Ziehungen</div>
      ${hist || '<div style="color:var(--m);font-size:.85rem;">Noch keine Ziehung.</div>'}
      <div style="font-size:.68rem;color:var(--m2);margin-top:8px;">Nur zum Spaß mit Gurkenpunkten. Gezogen wird serverseitig.</div>`;
  }

  async function act(a, d) {
    const c = L.data && L.data.cfg;
    if (a === 'lt_n' && c) { const n = +d.v; L.picks = L.picks.includes(n) ? L.picks.filter(x => x !== n) : L.picks.length < c.picks ? [...L.picks, n].sort((x, y) => x - y) : L.picks; return render(); }
    if (a === 'lt_s') { L.sz = L.sz === +d.v ? null : +d.v; return render(); }
    if (a === 'lt_clear') { L.picks = []; L.sz = null; return render(); }
    if (a === 'lt_rand' && c) {
      const pool = Array.from({ length: c.pool }, (_, i) => i + 1);
      for (let i = 0; i < c.picks; i++) { const j = i + rndInt(pool.length - i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      L.picks = pool.slice(0, c.picks).sort((x, y) => x - y); L.sz = rndInt(c.szMax) + 1; return render();
    }
    if (S.pending) return;
    if (a === 'lt_buy' || a === 'lt_quick') {
      const j = await api('lotto', a === 'lt_buy' ? { action: 'buy', numbers: L.picks, sz: L.sz } : { action: 'buy', quick: true });
      if (j) {
        L.data = j; L.skew = j.now - Date.now(); L.last = Date.now(); L.picks = []; L.sz = null;
        S.info = `Schein abgegeben: ${j.bought.n.join(' · ')} + Superzahl ${j.bought.s}`; render();
      }
    }
  }
  return { html, act };
}
