// Gurkensöhne Cup - Casino-Oberfläche (Tab im Gurkengarten). Rechnet nichts selbst, alles kommt vom Worker.
// Einbinden in garden-module.js: siehe PATCHES.md
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RANK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'], SUIT = ['♠', '♥', '♦', '♣'];
const face = c => RANK[c % 13] + SUIT[Math.floor((c % 52) / 13)];
const isRedSuit = c => { const s = Math.floor((c % 52) / 13); return s === 1 || s === 2; };
const CHIPS = [5, 10, 25, 50];
const SIMPLE = [['red', '🔴 Rot'], ['black', '⚫ Schwarz'], ['even', 'Gerade'], ['odd', 'Ungerade'], ['low', '1–18'], ['high', '19–36']];

export function createCasino({ S, api, render, esc, db, ref, onValue }) {
  const C = { sub: 'roulette', chip: 10, bets: {}, spin: null, bjBet: 10, bj: null, bjRes: null, watch: '' };

  function watch() {
    const name = S.login && S.login.name; if (name === C.watch) return;
    C.watch = name || ''; C.bj = null;
    if (name) onValue(ref(db, `press/casino/${name}/bj/view`), s => { if (C.watch === name) { C.bj = s.val(); render(); } });
  }
  const total = () => Object.values(C.bets).reduce((a, b) => a + b.a, 0);
  const card = (c, hidden) => `<span style="display:inline-block;min-width:34px;text-align:center;margin:2px;padding:6px 4px;border-radius:6px;background:${hidden ? '#244' : '#f4f4ee'};color:${hidden ? '#9bd' : isRedSuit(c) ? '#c00' : '#111'};font-weight:800;">${hidden ? '?' : face(c)}</span>`;
  const numBtn = n => `<button class="mini" style="padding:6px 0;color:#fff;background:${n === 0 ? '#1b7a3a' : RED.has(n) ? '#b3202a' : '#222'};${C.bets['num:' + n] ? 'outline:2px solid var(--y);' : ''}" data-act="cs_bet" data-t="num" data-v="${n}">${n}</button>`;
  const amount = (t, v) => C.bets[t + ':' + v] ? ` <b style="color:var(--y)">${C.bets[t + ':' + v].a}</b>` : '';

  function roulette() {
    const r = C.spin;     const nb = (n, st) => `<button class="mini" style="padding:9px 0;color:#fff;background:${n === 0 ? '#1b7a3a' : RED.has(n) ? '#b3202a' : '#222'};${C.bets['num:' + n] ? 'outline:2px solid var(--y);' : ''}${st}" data-act="cs_bet" data-t="num" data-v="${n}">${n}${C.bets['num:' + n] ? `<br><b style="color:var(--y);font-size:.7rem;">${C.bets['num:' + n].a}</b>` : ''}</button>`;     const nums = Array.from({ length: 36 }, (_, i) => nb(i + 1, `grid-column:${(i % 3) + 2};grid-row:${Math.floor(i / 3) + 2};`)).join('');     const doz = [[1, '1–12'], [2, '13–24'], [3, '25–36']].map(([v, l]) => `<button class="mini" style="grid-column:1;grid-row:${(v - 1) * 4 + 2} / span 4;padding:0;${C.bets['dozen:' + v] ? 'outline:2px solid var(--y);' : ''}" data-act="cs_bet" data-t="dozen" data-v="${v}">${l}${amount('dozen', v)}</button>`).join('');     const cols = [1, 2, 3].map(v => `<button class="mini" style="grid-column:${v + 1};grid-row:14;padding:9px 0;${C.bets['col:' + v] ? 'outline:2px solid var(--y);' : ''}" data-act="cs_bet" data-t="col" data-v="${v}">Sp. ${v}${amount('col', v)}</button>`).join('');
    return `<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;"><span style="font-size:.8rem;color:var(--m);">Chip:</span>${CHIPS.map(c => `<button class="tab-btn ${C.chip === c ? 'active' : ''}" data-act="cs_chip" data-v="${c}">${c}</button>`).join('')}</div>
      <div style="display:grid;grid-template-columns:58px repeat(3,1fr);gap:4px;max-width:360px;margin:0 auto 10px;">${nb(0, 'grid-column:2 / span 3;grid-row:1;')}${nums}${doz}${cols}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px;">${SIMPLE.map(([t, l]) => `<button class="mini" data-act="cs_bet" data-t="${t}">${l}${amount(t, null)}</button>`).join('')}</div>
      <div style="font-size:.78rem;color:var(--m);margin:6px 0;">Zahl 36×, Dutzend/Spalte 3×, Rot/Schwarz/Gerade/Ungerade/Hälfte 2× (inklusive Einsatz). Europäisch mit einer Null.</div>
      <button class="btn" ${S.pending || !total() ? 'disabled' : ''} data-act="cs_spin">${S.pending === 'roulette' ? 'Kugel rollt ...' : `Drehen (Einsatz ${total()})`}</button>
      <button class="btn ghost" data-act="cs_clear">Wetten löschen</button>
      ${r ? `<div class="slot-card"><div style="font:800 2rem var(--hd);text-align:center;"><span style="color:${r.color === 'red' ? '#ff5555' : r.color === 'green' ? '#5ee08a' : '#ddd'}">${r.n}</span></div>
        <div style="text-align:center;font-weight:700;">${r.net > 0 ? `+${r.net} Punkte 🎉` : r.net === 0 ? 'Plus/Minus null' : `${r.net} Punkte`}</div>
        <div style="text-align:center;font-size:.75rem;color:var(--m);margin-top:4px;">Heute noch bis ${r.allowance} Punkte Einsatz, ${r.playsLeft} Runden.</div></div>` : ''}`;
  }

  function blackjack() {
    const v = C.bj, open = v && v.open;
    const hand = (cards, hideSecond) => cards.map((c, i) => card(c, false)).join('') + (hideSecond ? card(0, true) : '');
    let h = '';
    if (v) h += `<div class="slot-card"><div style="font-size:.75rem;color:var(--m);">Dealer ${v.dealerTotal != null ? `(${v.dealerTotal})` : ''}</div><div>${hand(v.dealer, open)}</div>
      <div style="font-size:.75rem;color:var(--m);margin-top:8px;">Du (${v.playerTotal}) · Einsatz ${v.bet}${v.doubled ? ' (verdoppelt)' : ''}</div><div>${hand(v.player, false)}</div>
      ${!open && v.outcome ? `<div class="note ${v.outcome === 'lose' ? '' : 'gold'}" style="margin-top:8px;">${{ blackjack: '🂡 Blackjack!', win: '✅ Gewonnen', lose: '❌ Verloren', push: '🤝 Unentschieden' }[v.outcome]} · Auszahlung ${v.payout}</div>` : ''}</div>`;
    if (open) {
      h += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;"><button class="btn" style="margin-top:8px;" ${S.pending ? 'disabled' : ''} data-act="cs_hit">Karte</button>
        <button class="btn ghost" style="margin-top:8px;" ${S.pending ? 'disabled' : ''} data-act="cs_stand">Halten</button>
        <button class="btn ghost" style="margin-top:8px;" ${S.pending || !v.canDouble ? 'disabled' : ''} data-act="cs_double">Verdoppeln</button></div>`;
    } else {
      h += `<div style="display:flex;gap:6px;margin:10px 0;align-items:center;flex-wrap:wrap;"><span style="font-size:.8rem;color:var(--m);">Einsatz:</span>${[5, 10, 25, 50, 100].map(c => `<button class="tab-btn ${C.bjBet === c ? 'active' : ''}" data-act="cs_bjbet" data-v="${c}">${c}</button>`).join('')}</div>
        <button class="btn" ${S.pending ? 'disabled' : ''} data-act="cs_deal">${S.pending === 'blackjack' ? '...' : `Austeilen (${C.bjBet})`}</button>`;
    }
    if (C.bjRes) h += `<div style="text-align:center;font-size:.75rem;color:var(--m);margin-top:6px;">Heute noch bis ${C.bjRes.allowance} Punkte Einsatz.</div>`;
    return h + '<div style="font-size:.75rem;color:var(--m);margin-top:8px;">6 Decks, neuer Schuh pro Hand. Blackjack zahlt 3:2, Dealer steht bei jeder 17. Kein Splitten, keine Versicherung. Eine offene Hand wird nach 30 Minuten automatisch gehalten.</div>';
  }

  function html() {
    if (!S.login) return '<div style="color:var(--m);font-size:.85rem;">Melde dich an, um zu spielen.</div>';
    watch();
    return `<div class="note" style="font-size:.78rem;">🎰 Nur zum Spaß mit Gurkenpunkten. Pro Tag ist bei 300 Punkten Netto-Verlust Schluss, damit niemand sein Konto leerräumt.</div>
      <div class="tabs" style="margin-bottom:10px;"><button class="tab-btn ${C.sub === 'roulette' ? 'active' : ''}" data-act="cs_sub" data-v="roulette">Roulette</button><button class="tab-btn ${C.sub === 'bj' ? 'active' : ''}" data-act="cs_sub" data-v="bj">Blackjack</button></div>`
      + (C.sub === 'roulette' ? roulette() : blackjack());
  }

  async function act(a, d) {
    if (a === 'cs_sub') { C.sub = d.v; S.msg = ''; return render(); }
    if (a === 'cs_chip') { C.chip = +d.v; return render(); }
    if (a === 'cs_bjbet') { C.bjBet = +d.v; return render(); }
    if (a === 'cs_clear') { C.bets = {}; return render(); }
    if (a === 'cs_bet') {
      const v = d.v === undefined ? null : +d.v, k = d.t + ':' + v, cur = C.bets[k];
      C.bets[k] = { t: d.t, v, a: (cur ? cur.a : 0) + C.chip }; return render();
    }
    if (a === 'cs_spin') {
      const j = await api('roulette', { bets: Object.values(C.bets).map(b => ({ t: b.t, ...(b.v !== null ? { v: b.v } : {}), a: b.a })) });
      if (j) { C.spin = j; C.bets = {}; S.info = ''; render(); }
      return;
    }
    const map = { cs_deal: ['deal', { bet: C.bjBet }], cs_hit: ['hit'], cs_stand: ['stand'], cs_double: ['double'] };
    if (map[a]) { const j = await api('blackjack', { action: map[a][0], ...(map[a][1] || {}) }); if (j) { C.bjRes = j; if (j.view) C.bj = j.view; render(); } }
  }
  return { html, act };
}
