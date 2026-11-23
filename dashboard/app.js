'use strict';
/* Launch Radar page: renders window.RADAR (written beside this page by main.ts) as a sortable,
   filterable board with a detail view per protocol. No fetch, no framework, no network. */

const R = window.RADAR;
const app = document.getElementById('app');

const state = {
  view: 'board',
  slug: null,
  q: '',
  category: '',
  chain: '',
  watchOnly: false,
  minImplied: 0,
  sortKey: 'rank',
  sortDir: 1,
};

/* Views are addressable: #/board?q=&cat=&chain=&watch=1&min= carries the filters, and
   #/p/<slug> opens a protocol's detail view, so any view of the radar can be linked. */
function readHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('p/')) {
    state.view = 'detail';
    state.slug = decodeURIComponent(h.slice(2));
    return;
  }
  const params = new URLSearchParams(h.replace(/^board\??/, ''));
  if (params.has('q')) state.q = params.get('q');
  if (params.has('cat')) state.category = params.get('cat');
  if (params.has('chain')) state.chain = params.get('chain');
  if (params.has('watch')) state.watchOnly = params.get('watch') === '1';
  if (params.has('min')) state.minImplied = Number(params.get('min')) || 0;
}

function writeHash() {
  if (state.view === 'detail') {
    history.replaceState(null, '', '#/p/' + encodeURIComponent(state.slug ?? ''));
    return;
  }
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category) params.set('cat', state.category);
  if (state.chain) params.set('chain', state.chain);
  if (state.watchOnly) params.set('watch', '1');
  if (state.minImplied) params.set('min', String(state.minImplied));
  const s = params.toString();
  history.replaceState(null, '', s ? '#/board?' + s : '#/board');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtUsd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n;
}
const fmtFull = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const fmtPct = (n) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const fmtAge = (d) => (d === null || d === undefined ? 'unknown' : d >= 730 ? (d / 365).toFixed(1) + ' yrs' : d + ' days');
const fmtMult = (n) => (n === null || n === undefined ? '—' : n.toFixed(2) + '×');

/* ---------- board ---------- */

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (state.watchOnly && !r.watchlist) return false;
    if (state.category && (r.category ?? 'Uncategorised') !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (r.implied_value_usd < state.minImplied) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.category ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
  const key = state.sortKey;
  const dir = state.sortDir;
  const val = (r) => (key === 'name' ? r.name.toLowerCase() : key === 'multiple' ? r.category_multiple : r[key === 'implied' ? 'implied_value_usd' : key]);
  rows = rows.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va < vb ? -1 : va > vb ? 1 : a.rank - b.rank) * dir;
  });
  return rows;
}

function headerHtml() {
  return `
  <header class="top">
    <div class="radar-mark" aria-hidden="true"></div>
    <div>
      <h1>Launch <span class="thin">Radar</span></h1>
      <p class="tagline">Protocols that record no token yet, ranked by what a launch would be worth:
      each one's TVL carried at the market-cap-to-TVL multiple its own category's live tokens trade at,
      adjusted for growth, seasoning and reach. Implied values are this board's own model, not a promise.</p>
    </div>
    <div class="stats">
      <div class="stat"><b>${R.protocols_size}</b><span>protocols scanned</span></div>
      <div class="stat"><b>${R.board_size}</b><span>ranked pre-token</span></div>
      <div class="stat"><b>${R.watchlist_size}</b><span>on the watchlist</span></div>
      <div class="stat"><b>${esc(R.as_of)}</b><span>snapshot date</span></div>
    </div>
  </header>`;
}

function controlsHtml(count) {
  const cats = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label ?? v)}</option>`;
  return `
  <div class="controls" id="board-anchor">
    <input type="search" id="f-q" placeholder="Search name, slug, category" value="${esc(state.q)}" aria-label="Search">
    <select id="f-cat" aria-label="Category">${opt('', state.category, 'All categories')}${cats.map((c) => opt(c, state.category)).join('')}</select>
    <select id="f-chain" aria-label="Chain">${opt('', state.chain, 'All chains')}${chains.map((c) => opt(c, state.chain)).join('')}</select>
    <select id="f-min" aria-label="Minimum implied value">
      ${[[0, 'Any value'], [1e6, '$1M +'], [1e7, '$10M +'], [1e8, '$100M +'], [1e9, '$1B +']].map(([v, l]) => `<option value="${v}"${state.minImplied === v ? ' selected' : ''}>${l}</option>`).join('')}
    </select>
    <label class="check"><input type="checkbox" id="f-watch"${state.watchOnly ? ' checked' : ''}> Watchlist only</label>
    <span class="count">${count} of ${R.board_size} shown</span>
  </div>`;
}

const COLUMNS = [
  ['rank', '#'],
  ['name', 'Protocol'],
  ['chains', 'Chains'],
  ['tvl_usd', 'TVL'],
  ['change_7d', '7d'],
  ['age_days', 'Age'],
  ['multiple', 'Mult'],
  ['implied', 'Implied value'],
];

function boardHtml() {
  const rows = visibleRows();
  const head = COLUMNS.map(([k, label]) => {
    const sorted = state.sortKey === k;
    const arrow = sorted ? (state.sortDir === 1 ? ' ↑' : ' ↓') : '';
    return `<th data-sort="${k}" class="${sorted ? 'sorted' : ''}">${label}${arrow}</th>`;
  }).join('');
  const body = rows
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}">
      <td class="rank">${r.rank}</td>
      <td class="name"><b>${esc(r.name)}</b>${r.watchlist ? '<span class="badge">watchlist</span>' : ''}<span class="cat">${esc(r.category ?? 'Uncategorised')}</span></td>
      <td><span class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''}</span></td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${fmtPct(r.change_7d)}</td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td class="num">${fmtMult(r.category_multiple)}</td>
      <td class="implied">${fmtUsd(r.implied_value_usd)}</td>
    </tr>`,
    )
    .join('');
  return `
  <div id="board-block">
  ${controlsHtml(rows.length)}
  <table class="board" aria-label="Pre-token protocols ranked by implied value">
    <thead><tr>${head}</tr></thead>
    <tbody>${body || ''}</tbody>
  </table>
  ${rows.length === 0 ? '<div class="empty">No protocol matches those filters. Loosen one and sweep again.</div>' : ''}
  </div>`;
}

function comparablesHtml() {
  const live = R.live
    .map(
      (p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category ?? 'Uncategorised')}</td><td class="num">${fmtUsd(p.mcap_usd)}</td><td class="num">${fmtUsd(p.tvl_usd)}</td><td class="num">${fmtMult(p.mcap_tvl)}</td></tr>`,
    )
    .join('');
  const cats = [...R.categories]
    .sort((a, b) => b.comps - a.comps)
    .slice(0, 12)
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.comps}</td><td class="num">${fmtMult(c.multiple)}</td></tr>`)
    .join('');
  return `
  <section class="panel">
    <h2>The comparables: protocols whose token already trades</h2>
    <p>These are kept off the ranked board — their token exists, so the market has already priced them.
    They are the board's yardstick: the multiple on the right is what the market pays per dollar of TVL,
    and the ranked board carries each pre-token protocol at its own category's version of it.
    Across all ${R.global_comps} live comparables the median is <b>${fmtMult(R.global_multiple)}</b>.</p>
    <table class="mini" aria-label="Live-token comparables">
      <thead><tr><th>Protocol</th><th>Category</th><th>Market cap</th><th>TVL</th><th>MCap / TVL</th></tr></thead>
      <tbody>${live}</tbody>
    </table>
    <p style="margin-top:16px">Category multiples after shrinkage toward the global median (a category with
    few live tokens borrows strength from the whole market rather than trusting two or three prices):</p>
    <table class="mini" aria-label="Category multiples">
      <thead><tr><th>Category</th><th>Live comparables</th><th>Multiple used</th></tr></thead>
      <tbody>${cats}</tbody>
    </table>
  </section>`;
}

function modelHtml() {
  const m = R.model;
  return `
  <section class="panel">
    <h2>The model (${esc(R.model_version)}), stated in the open</h2>
    <p>An implied value is a claim about one protocol, built only from figures the snapshot itself carries:
    its TVL, its category, its seven-day TVL change, the day DefiLlama began tracking it, and its chains.
    No name is special-cased and no figure comes from outside the snapshot.</p>
    <div class="formula">implied = TVL × category multiple × growth factor × age factor × breadth factor</div>
    <p><b>Category multiple</b> — the median market-cap-to-TVL of the category's live protocols, shrunk toward the
    global median with a prior of ${m.shrink_prior} when comparables are few. <b>Growth factor</b> —
    max(${m.growth_factor_floor}, 1 + clamp(7d change, ${m.growth_floor_pct}%, ${m.growth_cap_pct}%) × ${m.growth_weight}).
    <b>Age factor</b> — ${m.age_base} + ${m.age_range} × min(age, ${m.age_days_cap} days) / ${m.age_days_cap}: a protocol that has
    run for years with no token is a more credible launch than a three-week-old one. <b>Breadth factor</b> —
    1 + ${m.breadth_per_chain} per extra chain, up to ${m.breadth_chain_cap}. Open any row to see its own arithmetic.</p>
    <p>The board is the snapshot's ${R.watchlist_size}-protocol watchlist (TVL at or above ${fmtUsd(R.floor_usd)},
    no token recorded, not a wrapped or staked product) plus every other protocol that records no token and passes
    the same product screen, above and below the floor — ${R.early_size} more rows the watchlist leaves out.
    Say a protocol <i>records</i> no token, never that it has none: a record can lag a launch.</p>
  </section>
  <footer class="foot">Source: ${esc(R.source)}. Snapshot frozen at ${esc(R.as_of)}; the board does not move after that date.
  Farm plans are a starting routine, not financial advice, and no plan here promises an airdrop: most protocols
  never issue a token, and farming one costs real gas and locked capital either way.</footer>`;
}

function renderBoard() {
  app.innerHTML = `<div class="wrap">${headerHtml()}<main>${boardHtml()}${comparablesHtml()}${modelHtml()}</main></div>`;
  app.setAttribute('aria-busy', 'false');
  writeHash();
  wireControls();
  window.scrollTo(0, 0);
}

function wireControls() {
  const q = document.getElementById('f-q');
  q.addEventListener('input', () => { state.q = q.value; refreshTable(); });
  document.getElementById('f-cat').addEventListener('change', (e) => { state.category = e.target.value; refreshTable(); });
  document.getElementById('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; refreshTable(); });
  document.getElementById('f-min').addEventListener('change', (e) => { state.minImplied = Number(e.target.value); refreshTable(); });
  document.getElementById('f-watch').addEventListener('change', (e) => { state.watchOnly = e.target.checked; refreshTable(); });
  wireTable();
}

function wireTable() {
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = k === 'name' ? 1 : -1; if (k === 'rank') state.sortDir = 1; }
      refreshTable();
    });
  });
  document.querySelectorAll('tr[data-slug]').forEach((tr) => {
    tr.addEventListener('click', () => {
      state.view = 'detail';
      state.slug = tr.getAttribute('data-slug');
      renderDetail();
    });
  });
}

/* Re-render the controls + table block in place, keeping the search box's focus and caret. */
function refreshTable() {
  const hadFocus = document.activeElement && document.activeElement.id === 'f-q';
  const block = document.getElementById('board-block');
  const tpl = document.createElement('template');
  tpl.innerHTML = boardHtml().trim();
  block.replaceWith(tpl.content.firstElementChild);
  wireControls();
  if (hadFocus) {
    const box = document.getElementById('f-q');
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

/* ---------- detail ---------- */

function renderDetail() {
  const r = R.rows.find((x) => x.slug === state.slug) ?? R.rows[0];
  state.slug = r.slug;
  writeHash();
  const steps = r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('');
  app.innerHTML = `
  <div class="wrap">
    ${headerHtml()}
    <button class="back" id="back">← Back to the board</button>
    <div class="detail-head">
      <h2>${esc(r.name)}</h2>
      <span class="sub">#${r.rank} of ${R.board_size} · ${esc(r.category ?? 'Uncategorised')} · ${esc(r.slug)}${r.watchlist ? ' · on the house watchlist' : ' · found by the radar below the watchlist floor'}</span>
    </div>
    <div class="grid">
      <div class="cell"><b>${fmtFull(r.implied_value_usd)}</b><span>implied value</span></div>
      <div class="cell"><b>${fmtFull(r.tvl_usd)}</b><span>TVL</span></div>
      <div class="cell"><b>${fmtPct(r.change_7d)}</b><span>TVL change, 7d</span></div>
      <div class="cell"><b>${fmtAge(r.age_days)}</b><span>tracked, no token</span></div>
      <div class="cell"><b>${r.listed_at ? esc(r.listed_at) : '—'}</b><span>tracking since</span></div>
      <div class="cell"><b>${r.chains.length}</b><span>chains</span></div>
    </div>
    <section class="panel">
      <h2>How the model gets there</h2>
      <div class="formula">${fmtFull(r.tvl_usd)} × ${fmtMult(r.category_multiple)} × ${r.growth_factor.toFixed(2)} × ${r.age_factor.toFixed(2)} × ${r.breadth_factor.toFixed(2)} = ${fmtFull(r.implied_value_usd)}</div>
      <p>TVL carried at the <b>${esc(r.category ?? 'Uncategorised')}</b> multiple of ${fmtMult(r.category_multiple)},
      read from ${r.category_comps} live comparable${r.category_comps === 1 ? '' : 's'} in that category.
      Growth factor ${r.growth_factor.toFixed(2)} from a seven-day TVL change of ${fmtPct(r.change_7d)};
      age factor ${r.age_factor.toFixed(2)} for ${fmtAge(r.age_days)} tracked with no token recorded;
      breadth factor ${r.breadth_factor.toFixed(2)} for running on ${esc(r.chains.join(', ') || 'one chain')}.
      The value is what a token would be worth if the protocol's record stayed as it is — not a forecast that one is coming.</p>
    </section>
    <section class="panel">
      <h2>Farm plan</h2>
      <p>Six steps, in order, each with what it costs and how long it takes. The plan farms the chance of a
      launch allocation; it cannot promise one, and the capital and gas are spent either way.</p>
      <ol class="steps">${steps}</ol>
    </section>
  </div>`;
  document.getElementById('back').addEventListener('click', () => {
    state.view = 'board';
    renderBoard();
  });
  window.scrollTo(0, 0);
}

readHash();
if (state.view === 'detail') renderDetail();
else renderBoard();
