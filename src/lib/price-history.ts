import { gzipSync, gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Append-only price observations.
 *
 * THE PROBLEM THIS SOLVES. `data/prices/{game}.json` is the CURRENT price of
 * every card, and `prebuild` replaces it wholesale on every run. It carries one
 * `generatedAt` for the entire file and no per-row timestamp, so it is a
 * snapshot pretending to be a series: the moment a refresh runs, what a card was
 * worth before it is no longer written down anywhere we chose to write it.
 *
 * WHAT WAS ACTUALLY LOST, MEASURED. Less than first assumed, and the correction
 * matters. Git has been keeping the old snapshots by accident — 12 commits touch
 * the Pokémon file, and any of them can be read back with `git show`. So the
 * history is not gone. It is *accidental*: it exists at the cadence someone
 * happened to commit, in a form nobody can query, and it would vanish the first
 * time the file was gitignored or the data moved. This module turns that
 * accident into a decision.
 *
 * WHY A SEPARATE, COMPACT FILE rather than versioning the snapshot itself.
 * Measured 2026-09-07: the full Pokémon snapshot is 6.0 MB (890 KB gzipped), and
 * 97% of its rows change between observations, so storing diffs saves almost
 * nothing. A series does not need every field — it needs one headline number per
 * PRINTING per day. That compacts to 854 KB, or **181 KB gzipped**, which is
 * ~64 MB a year against a repository currently at 17 MB.
 *
 * WHY THAT COST IS ACCEPTABLE, stated as a decision rather than assumed: not
 * recording is irreversible and recording is reversible. Daily files are
 * independent, so they can be pruned, thinned to weekly, or moved into Postgres
 * later without touching anything that reads them. Git is not a time-series
 * database and is not pretending to be one; it is the store that needs no new
 * service, which is the right trade at this size. Revisit at ~500 MB, or when a
 * real database arrives — whichever comes first.
 *
 * WHAT THIS DOES NOT GIVE YOU, so nobody is surprised later: `prebuild` also
 * runs on Vercel, where the filesystem is discarded after the build. An
 * observation is therefore recorded whenever the refresh runs somewhere its
 * output is committed — in practice, a local build. That makes the observation
 * explicit and dated instead of incidental; it does not make it daily. A
 * guaranteed cadence needs a scheduled job, which is deliberately not built yet.
 *
 * ONE FILE PER DAY, last write winning. Intraday movement is not worth 365
 * extra files a year for cards whose prices are quoted as daily averages
 * anyway, and a stable filename means a re-run repairs a bad observation
 * instead of appending a second one beside it.
 */

const HISTORY_DIR = path.join(process.cwd(), "data", "prices", "history");

/**
 * One printing's headline price on one day.
 *
 * Keys are deliberately short because they repeat 20,443 times per file:
 *   `_`   Cardmarket average, the plain field (the card's main printing)
 *   `h`   Cardmarket average, `-holo` suffix — the reverse-holo printing
 *   two-letter keys are TCGplayer blocks (`no`rmal, `re`verse-holofoil,
 *   `ho`lofoil, `1s`t-edition, `un`limited, …), carrying that block's market price
 *
 * PER PRINTING, not per card, because that is the unit whose price actually
 * moves independently: a reverse holo trades at a median 3.36x its normal twin
 * (docs/free-tier-catalogue.md §3d). A per-card series would average away the
 * only distinction that matters.
 */
export type PriceObservationRow = Record<string, number>;

export type PriceObservationFile = {
  /** When this observation was taken. The thing the snapshot format lacks. */
  observedAt: string;
  /** Where the figures came from, so a series can be read across a source change. */
  source: string;
  game: string;
  /** Key: the card's id in its own catalogue (`sv08-001`). */
  cards: Record<string, PriceObservationRow>;
};

/**
 * The two snapshot shapes on disk. They differ because they were written by
 * different scripts at different times, and discovering that the hard way is
 * why this type has four fields instead of two: the first backfill produced a
 * 116-byte One Piece observation containing nothing at all, because it looked
 * for `cm`/`tp` in a file that spells them `cardmarket`/`tcgplayer`.
 *
 *   pokemon.json    { cm: {avg, "avg-holo", ...}, tp: { <block>: {market} } }
 *   one-piece.json  { cardmarket: {avg, ...},     tcgplayer: {market, ...} }
 *
 * Normalising here rather than rewriting either file keeps a format change out
 * of the pages that read them, and an observation series has to span both
 * anyway — it is meant to outlive the shape it was collected in.
 */
type SnapshotEntry = {
  cm?: Record<string, number>;
  tp?: Record<string, { market?: number } | undefined>;
  cardmarket?: Record<string, number>;
  tcgplayer?: { market?: number };
};

/**
 * Reduce a full snapshot row to the headline numbers worth keeping forever.
 *
 * Returns undefined for a row with no usable figure, so an unpriced card is
 * ABSENT from the observation rather than present as zero — the same rule the
 * rest of the codebase holds, because "we have no price" and "this is worthless"
 * are different claims and only one of them is ever true.
 */
export function compactRow(entry: SnapshotEntry): PriceObservationRow | undefined {
  const row: PriceObservationRow = {};

  const cm = entry.cm ?? entry.cardmarket ?? {};
  if (typeof cm.avg === "number") row._ = cm.avg;
  if (typeof cm["avg-holo"] === "number") row.h = cm["avg-holo"];

  // One Piece carries a single TCGplayer figure rather than per-block ones,
  // because its rows are per PRINTING already — the block names Pokemon needs
  // exist to separate printings that share a card id, which One Piece does not.
  if (typeof entry.tcgplayer?.market === "number") row.tp = entry.tcgplayer.market;

  for (const [block, figures] of Object.entries(entry.tp ?? {})) {
    const market = figures?.market;
    // Two letters is enough to separate every block TCGdex publishes — normal,
    // reverse-holofoil, holofoil, 1st-edition, unlimited, and the two -holofoil
    // era twins collide only on their prefix, which the full name disambiguates
    // nowhere else in this file either.
    if (typeof market === "number") row[block.slice(0, 2)] = market;
  }

  return Object.keys(row).length > 0 ? row : undefined;
}

/** `data/prices/history/pokemon-2026-09-07.json.gz` */
export function observationPath(game: string, when: Date): string {
  return path.join(HISTORY_DIR, `${game}-${when.toISOString().slice(0, 10)}.json.gz`);
}

/**
 * Write today's observation for `game`, derived from a full snapshot.
 *
 * Returns what it wrote, so a caller can report it honestly rather than
 * announcing a file it did not verify.
 */
export function recordObservation(
  game: string,
  source: string,
  cards: Record<string, SnapshotEntry>,
  when = new Date()
): { file: string; cards: number; bytes: number; written: boolean } {
  const rows: Record<string, PriceObservationRow> = {};
  for (const [id, entry] of Object.entries(cards)) {
    const row = compactRow(entry);
    if (row) rows[id] = row;
  }

  const payload: PriceObservationFile = {
    observedAt: when.toISOString(),
    source,
    game,
    cards: rows,
  };

  // An observation with no rows is not an observation. Writing one would put a
  // 116-byte file in the series claiming that on this day nothing had a price,
  // which is a stronger and less true statement than staying silent.
  if (Object.keys(rows).length === 0) {
    return { file: observationPath(game, when), cards: 0, bytes: 0, written: false };
  }

  mkdirSync(HISTORY_DIR, { recursive: true });
  const file = observationPath(game, when);
  // Level 9: written once, read rarely, kept forever — the extra CPU is free
  // and the bytes are permanent.
  const bytes = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  writeFileSync(file, bytes);

  return { file, cards: Object.keys(rows).length, bytes: bytes.length, written: true };
}

/** Every observation on disk for a game, oldest first. Filenames sort chronologically by construction. */
export function listObservations(game: string): string[] {
  if (!existsSync(HISTORY_DIR)) return [];
  return readdirSync(HISTORY_DIR)
    .filter((name) => name.startsWith(`${game}-`) && name.endsWith(".json.gz"))
    .sort()
    .map((name) => path.join(HISTORY_DIR, name));
}

export function readObservation(file: string): PriceObservationFile {
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as PriceObservationFile;
}

/**
 * One card's price series, oldest first — the thing none of this was able to
 * answer before.
 *
 * Reads every observation file, which is fine at a file a day and deliberately
 * not optimised: this is an analysis path, not a render path, and no page is
 * allowed to call it. When that stops being true, the series belongs in a
 * database and this function is the thing being replaced.
 */
export function priceSeries(
  game: string,
  cardId: string,
  printing = "_"
): { observedAt: string; price: number }[] {
  const out: { observedAt: string; price: number }[] = [];
  for (const file of listObservations(game)) {
    const observation = readObservation(file);
    const price = observation.cards[cardId]?.[printing];
    if (typeof price === "number") out.push({ observedAt: observation.observedAt, price });
  }
  return out;
}
