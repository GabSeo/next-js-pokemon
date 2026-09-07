#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Recover price observations that git has been keeping by accident.
 *
 * WHY THIS EXISTS. `data/prices/pokemon.json` is the CURRENT price of every
 * card, replaced wholesale on every refresh. That looks like data loss, and the
 * first version of ARCHITECTURE_AUDIT.md said so. It was wrong: every commit
 * that touched the file is a dated snapshot, and `git show` reads it back. The
 * history was never destroyed — it was *accidental*, existing at whatever
 * cadence someone happened to commit, in a form nobody could query.
 *
 * This turns that accident into the same append-only series that
 * lib/price-history.ts writes going forward, so the record starts from the
 * project's own past rather than from today.
 *
 * DATED BY WHEN THE PRICES WERE READ, not by when they were committed. A
 * snapshot's `generatedAt` is the moment the refresh actually ran; the commit
 * date is just when someone got round to saving it, and the two differ by days.
 * An observation dated by the commit would claim prices were seen on a day
 * nobody looked.
 *
 * An earlier version of this script used both — commit date for the filename,
 * generation date for the contents — and wrote each snapshot twice to reconcile
 * them. That silently clobbered a day: three commits dated 2026-09-06 all
 * carried a snapshot generated on the 5th, so each overwrote the 5th's file and
 * then wrote a 6th, and the bookkeeping tracked the wrong path. The fix is not
 * better bookkeeping, it is having one rule.
 *
 * IDEMPOTENT. One file per day, last write winning, exactly like the live
 * recorder. Re-running repairs rather than duplicates. Existing files are
 * skipped unless --force, so this cannot quietly overwrite a real observation
 * with a reconstructed one.
 *
 *   npx tsx scripts/price-history-backfill.mts            # both games
 *   npx tsx scripts/price-history-backfill.mts --force    # rewrite existing
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { observationPath, recordObservation } from "../src/lib/price-history";

const GAMES = [
  { game: "pokemon", file: "data/prices/pokemon.json" },
  { game: "one-piece", file: "data/prices/one-piece.json" },
];

const force = process.argv.includes("--force");

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

let written = 0;
let skipped = 0;

/**
 * Files this run has produced.
 *
 * Needed because "skip what already exists" and "the later commit of a day
 * wins" contradict each other otherwise: eleven of twelve Pokemon commits share
 * one date, so the first one processed created the file and the other ten were
 * skipped as pre-existing — leaving the OLDEST observation of that day on disk,
 * which is the opposite of the stated rule. Anything written by this run is
 * fair game to overwrite; anything that was here before it started is not.
 */
const writtenThisRun = new Set<string>();

for (const { game, file } of GAMES) {
  // `--follow` so a rename in the file's past does not truncate the series.
  const log = git(["log", "--format=%H %cI", "--follow", "--", file]).trim();
  if (!log) {
    console.log(`[backfill] ${game}: no commits touch ${file}`);
    continue;
  }

  const commits = log.split("\n").map((line) => {
    const [sha, committedAt] = line.split(" ");
    return { sha, committedAt };
  });
  console.log(`[backfill] ${game}: ${commits.length} commit(s) carry ${file}`);

  // Oldest first, so that when two commits share a day the later one wins —
  // matching "last write of the day" in the live recorder.
  for (const { sha, committedAt } of [...commits].reverse()) {
    // Read the blob before deciding to skip: the date that names the file comes
    // from inside it, not from the commit.
    let snapshot: { source?: string; generatedAt?: string; cards?: Record<string, unknown> };
    try {
      snapshot = JSON.parse(git(["show", `${sha}:${file}`]));
    } catch {
      // A commit where the file was added empty, or is unreadable at that
      // revision. Not an error worth stopping a backfill for.
      console.log(`  ${sha.slice(0, 8)}  ${committedAt.slice(0, 10)}  unreadable, skipped`);
      continue;
    }

    const observedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date(committedAt);
    const target = observationPath(game, observedAt);

    if (!force && existsSync(target) && !writtenThisRun.has(target)) {
      skipped++;
      continue;
    }

    const result = recordObservation(game, snapshot.source ?? "unknown", (snapshot.cards ?? {}) as never, observedAt);

    if (!result.written) {
      console.log(`  ${sha.slice(0, 8)}  ${committedAt.slice(0, 10)}  no priced rows, not written`);
      continue;
    }

    if (!writtenThisRun.has(result.file)) written++;
    writtenThisRun.add(result.file);
    console.log(
      `  ${sha.slice(0, 8)}  committed ${committedAt.slice(0, 10)}  observed ${observedAt.toISOString().slice(0, 10)}  ` +
        `${result.cards} printings, ${(result.bytes / 1024).toFixed(0)} KB`
    );
  }
}

console.log(`\n[backfill] ${written} observation(s) written, ${skipped} already present.`);
if (skipped > 0 && !force) console.log("[backfill] Pass --force to rewrite the ones that exist.");
