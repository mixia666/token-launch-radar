// Launch Radar model: one sealed DefiLlama snapshot in, one ranked board of pre-token protocols out.
//
// The idea: a protocol that records no token has no market price, but the protocols that already
// trade leave a price for TVL in the same snapshot. For every category, the live protocols give a
// market-cap-to-TVL multiple; a pre-token protocol's implied value is its own TVL carried at its
// category's multiple, then adjusted by what else its record shows: its seven-day TVL growth, how
// long it has run with no token (seasoning), and how many chains it runs on (breadth).
//
//   multiple   = median market cap / TVL of the category's live protocols, shrunk toward the
//                global median when the category has few live comparables
//   growth     = clamp(change_7d, -50, 100);  growthFactor  = max(0.35, 1 + growth / 100 x 0.6)
//   ageFactor  = 0.75 + 0.45 x min(age_days, 1460) / 1460        (unknown age counts as 365 days)
//   breadth    = 1 + 0.02 x min(chains - 1, 5)
//   implied    = max(1, round(tvl_usd x multiple x growthFactor x ageFactor x breadth))
//
// The board is the snapshot's watchlist plus every other protocol that records no token and is not
// a wrapped, staked or bridged product of one that trades: the house's own screen (its categories,
// its version markers, its name rules) applied to the whole snapshot, above and below the floor.
// No protocol name is ever special-cased: one function screens and scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's live comparables: how many, and the multiple they imply. */
export interface CategoryMultiple {
  category: string;
  comps: number;
  multiple: number;
}

/** The model's constants, stated in the dashboard so a reader can re-run the board by hand. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  growth_factor_floor: number;
  age_base: number;
  age_range: number;
  age_days_cap: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_chain_cap: number;
  shrink_prior: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_factor_floor: 0.35,
  age_base: 0.75,
  age_range: 0.45,
  age_days_cap: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_chain_cap: 5,
  shrink_prior: 4,
};

/** The model's version label, named in the dashboard and in every board row's breakdown. */
export const MODEL_VERSION = 'comps-2';

/** How many live-token protocols the comparables view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    version: string;
    category_multiple: number;
    category_comps: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
    breadth_factor: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_comps: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own figures. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs: the board, the comparables, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  global_comps: number;
  categories: CategoryMultiple[];
  protocols_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word that marks a wrapped or staked product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchanges whose name at the front of a protocol's name marks its own product, not a launch. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The categories that are a wrapped, staked or bridged product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a pre-token protocol is a launch candidate of its own, not a wrapped, staked or bridged
 * product of one that trades: the house's screen, applied to any protocol the watchlist leaves out.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `))) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The multiples the snapshot itself prices: for each category, the median market-cap-to-TVL of its
 * live protocols (ratios kept between 0.005 and 20 so one broken record cannot carry a category),
 * shrunk toward the global median by the model's prior when the category's comparables are few.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { categories: CategoryMultiple[]; global: CategoryMultiple } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (r < 0.005 || r > 20) continue;
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key) ?? [];
    list.push(r);
    ratios.set(key, list);
    all.push(r);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const categories: CategoryMultiple[] = [];
  for (const [category, list] of ratios) {
    const shrunk = (list.length * median(list) + model.shrink_prior * globalMedian) / (list.length + model.shrink_prior);
    categories.push({ category, comps: list.length, multiple: round4(shrunk) });
  }
  categories.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { categories, global: { category: 'All categories', comps: all.length, multiple: round4(globalMedian) } };
}

/** The multiple one protocol is carried at: its category's, or the global one when it has no comps. */
function multipleFor(p: SnapshotProtocol, table: Map<string, CategoryMultiple>, global: CategoryMultiple): CategoryMultiple {
  if (p.category !== null) {
    const hit = table.get(p.category);
    if (hit !== undefined) return hit;
  }
  return global;
}

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiple: CategoryMultiple,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthFactor: number; ageFactor: number; breadthFactor: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, rawGrowth));
  const growthFactor = Math.max(model.growth_factor_floor, 1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const ageFactor = model.age_base + (Math.min(Math.max(ageForModel, 0), model.age_days_cap) / model.age_days_cap) * model.age_range;
  const breadthFactor = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_chain_cap);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple.multiple * growthFactor * ageFactor * breadthFactor));
  return { implied, growthPct, growthFactor, ageFactor, breadthFactor, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs in gas on a chain, in words a farmer can budget with. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$6 to $15 of gas a transaction at typical mainnet fees';
  if (chain === 'Solana') return 'under $0.05 of fees a transaction';
  if (chain === 'Bitcoin') return '$1 to $3 of fees a transaction';
  return 'under $1 of gas a transaction on that chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's opening move, in words a farmer can follow. */
function openingMove(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC as collateral to ${name} on ${chain}, then borrow about a third of it back so both sides of the book carry your address`;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC on ${name} on ${chain} and place it in the main pool or as margin for one small hedged trade`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} curated vault on ${chain} and keep the vault shares in the same wallet`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the receipt shares unmoved`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} through its own app and hold it in the farming wallet`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the balance`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the far side`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy until it expires`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and take one position in a liquid market on ${name}`;
  return `Deposit $${capital} of USDC into ${name}'s main product on ${chain} and keep the position open`;
}

/** The category's second move: the action that makes the first one look like use, not a drive-by. */
function secondMove(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Repay part of the borrow and borrow again once in the first month, so the position shows a full lend-and-borrow cycle on ${name}`;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return `Make two or three small swaps or trades a month on ${name}, spread across different weeks rather than one sitting`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Add a small top-up deposit to the same ${name} vault in the second month instead of opening a second position elsewhere`;
  if (c.includes('bridge')) return `Bridge a smaller amount back through ${name} once, so the wallet shows traffic in both directions`;
  return `Repeat the opening action once more in the second month with a smaller amount, so ${name} sees a returning user and not a single visit`;
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it takes. The
 * plan is derived from the protocol's own record (category, chain, TVL, age), never from a
 * hand-written list of names, and it never promises an airdrop: it farms the chance of one.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const steps = [
    `Set up one fresh wallet for ${p.name} alone, fund it from an exchange withdrawal, and keep its seed phrase offline on paper. Cost: nothing but the withdrawal fee. Time: 10 minutes.`,
    `${openingMove(p, capital, chain)}. Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
    `${secondMove(p, chain)}. Cost: ${gas} each time. Time: 10 minutes a session.`,
    `Make one qualifying action a week (a deposit, a swap, a vote or a top-up) so the wallet reads as a regular user of ${p.name}. Cost: about ${gas} a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity spans more than one weekly snapshot of the protocol. Cost: the $${capital} stays in the position and cannot be spent meanwhile. Time: ${hold} days.`,
    `Check ${p.name}'s own site and announcements for a points or rewards page before withdrawing, claim only from links the protocol itself publishes, then unwind. Cost: nothing to check, and never pay anyone to claim for you. Time: 15 minutes.`,
  ];
  return steps.map((s) => {
    const t = s.trim();
    if (t.length > 600) return `${t.slice(0, 596)}...`;
    if (t.length < 20) return `${t} Hold the position and re-check the protocol's own page weekly.`;
    return t;
  });
}

/** The protocols the board ranks, strongest first, with ranks 1..n and the model's working. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; multiples: { categories: CategoryMultiple[]; global: CategoryMultiple } } {
  const multiples = categoryMultiples(snapshot, model);
  const table = new Map(multiples.categories.map((c) => [c.category, c]));
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever the screen would say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The radar's own sweep: every other protocol that records no token and passes the product screen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const multiple = multipleFor(p, table, multiples.global);
    const v = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, multiple, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      category_multiple: s.multiple.multiple,
      category_comps: s.multiple.comps,
      growth_pct: s.growthPct,
      growth_factor: round4(s.growthFactor),
      age_factor: round4(s.ageFactor),
      breadth_factor: round4(s.breadthFactor),
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, multiples };
}

/** The live-token protocols, by market cap: the comparables the multiples are read from. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: multiples.global.multiple,
    global_comps: multiples.global.comps,
    categories: multiples.categories,
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      category_multiple: r.model.category_multiple,
      category_comps: r.model.category_comps,
      growth_factor: r.model.growth_factor,
      age_factor: r.model.age_factor,
      breadth_factor: r.model.breadth_factor,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') return `${r.slug} has an empty name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
