#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Prove the Limitless match points at the right card, on a random sample.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL. lib/limitless.ts connects two
 * catalogues that disagree about set codes AND about card numbers, through four
 * fallback rules. Every one of those rules is a chance to return a real,
 * loading, beautiful picture of the WRONG CARD — which is strictly worse than
 * returning nothing, because nothing is honest and a wrong picture is not. The
 * coverage script counts matches; only this one checks they are true.
 *
 * HOW. Limitless puts the card's name in its page title. So for a sample of
 * matched cards we ask them what card that is and compare it to what we think
 * it is. English is a direct comparison. Japanese is not — their pages carry an
 * English name against our Japanese one — so the Japanese sample is checked
 * against the Latin label the catalogue already derives (lib/card-label.ts),
 * which is species-level and therefore a weaker but real signal.
 *
 * ONE REQUEST PER SAMPLED CARD, so the sample stays small on purpose.
 *
 *   npx tsx scripts/limitless-verify.mts
 *   npx tsx scripts/limitless-verify.mts --sample 60 --languages en
 */
import { getCatalogEntries, type CatalogLanguage } from "../src/lib/catalog";
import { limitlessCardPage, limitlessImageUrl, limitlessMatch } from "../src/lib/limitless";
import { japaneseOfficialCard } from "../src/lib/pokemon-ja-official";

const args = process.argv.slice(2);
const sampleSize = args.includes("--sample") ? Number(args[args.indexOf("--sample") + 1]) || 40 : 40;
const only = args.includes("--languages") ? args[args.indexOf("--languages") + 1]?.split(",") : undefined;
const languages = (only ?? ["en", "ja"]) as CatalogLanguage[];

/** Their title is `Rowlet - Sun &amp; Moon Promos (SMP) #1 – Limitless`. */
function nameFromTitle(html: string): string | undefined {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) return undefined;
  return title
    .split(" - ")[0]
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Case, punctuation and the suffixes the two sides spell differently. */
function comparable(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ex|gx|v|vmax|vstar|break|prime|lv\.?x)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

let anyFailure = false;

for (const language of languages) {
  // Only cards Limitless is actually being asked to supply — the ones nothing
  // else pictures. Those are the matches that matter and the ones at risk.
  const rescued = getCatalogEntries(language).filter(({ card, set }) => {
    const pictured = card.image || (language === "ja" && japaneseOfficialCard(set.id, card.localId)?.img);
    return !pictured && limitlessImageUrl(set, card.localId, language);
  });

  // Spread across the whole list rather than taking the head: the head is one
  // set, and a rule that breaks on set 40 would never be sampled.
  const step = Math.max(1, Math.floor(rescued.length / sampleSize));
  const sample = rescued.filter((_, i) => i % step === 0).slice(0, sampleSize);

  console.log(`\n### ${language}: ${rescued.length} rescued cards, checking ${sample.length}`);

  let agreed = 0;
  let unreadable = 0;
  const disagreed: string[] = [];

  for (const { card, set, label } of sample) {
    // THEIR NUMBER, NOT OURS. Building this URL from `card.localId` was the
    // first version and it quietly tested nothing: our `SM01` is their `1`, so
    // every card resolved by the padding and prefix rules — precisely the risky
    // ones — 404'd and was written off as "unreadable" instead of checked. The
    // matcher reports the number it chose, so the page asked about here is the
    // page the picture actually came from.
    const url = limitlessCardPage(limitlessMatch(set, card.localId, language)!, language);

    let theirName: string | undefined;
    try {
      const response = await fetch(url, { headers: { "User-Agent": "pokecard-shop verifier" } });
      if (response.ok) theirName = nameFromTitle(await response.text());
    } catch {
      // network, not disagreement
    }
    if (!theirName) {
      unreadable++;
      continue;
    }

    /**
     * A JAPANESE CARD IS COMPARED THROUGH ITS LATIN LABEL, not its name.
     * Limitless titles are English on both sides of their site, so `ゲンガーex`
     * against "Gengar ex" would fail every time and prove nothing. The
     * catalogue already resolves a Pokedex-backed species label for exactly
     * this reason (lib/card-label.ts), and comparing that is a real test — it
     * catches the failure that matters, which is a card matched to a different
     * SPECIES. It does not catch a Gengar matched to another Gengar, and
     * saying so is better than a check that quietly passes everything.
     */
    const ourName = language === "ja" ? label : card.name;
    const ourLatin = comparable(ourName);
    const theirs = comparable(theirName);
    const ok = ourLatin === theirs || ourLatin.includes(theirs) || theirs.includes(ourLatin);

    if (ok) agreed++;
    else disagreed.push(`${set.id}-${card.localId}  ours "${ourName}"  theirs "${theirName}"`);
  }

  const checked = agreed + disagreed.length;
  console.log(`  agreed ${agreed}/${checked}${unreadable > 0 ? `   (${unreadable} pages unreadable)` : ""}`);
  for (const line of disagreed.slice(0, 15)) console.log(`    MISMATCH  ${line}`);
  if (disagreed.length > 0) anyFailure = true;
}

if (anyFailure) {
  console.error(`\nA mismatch means lib/limitless.ts is pointing a card at somebody else's picture.`);
  process.exit(1);
}
console.log(`\nEvery sampled match names the same card on both sides.`);
