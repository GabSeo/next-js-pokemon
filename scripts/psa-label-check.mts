#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Checks the grading-label reader that orders Pokemon printings.
 *
 * WHY A SCRIPT AND NOT A GLANCE. A Pokemon card's finish — normal, reverse
 * holo, holo — is invisible to every other part of this scanner: the artwork is
 * identical across all three (0 of 10,110 multi-variant cards have a distinct
 * image), so a slab's label is the only evidence that exists. That makes these
 * four regexes the whole feature, and a regex nobody exercises is a regex that
 * quietly stops matching.
 *
 * THE GRADE, NOT THE GRADER. The first version of this gate asked for the
 * company's name, and Vision's real output for the two PSA 10 slabs below
 * contains no "PSA" at all — the company sets its own name as a stylised logo,
 * so there is nothing there to read. "GEM MT" is read on both. A grade phrase
 * describes the slab rather than the card, which is also why none of them
 * appears in any of the 44,985 card names in either catalogue.
 *
 * THE NEGATIVE CASES MATTER MORE THAN THE POSITIVE ONES. The reader runs on
 * text that contains the card FACE as well as any label, so the question is not
 * only "does it read a real label" but "does it stay silent on everything
 * else". The case that proves it is real rather than imagined: an early version
 * of GRADER listed TAG and ACE Grading, and Pokemon prints "TAG TEAM" and
 * "ACE SPEC" on the face of real cards. Measured against Vision's own output
 * for img test/pokemon english/megasableye-tyranitargx-226-236.jpg on
 * 2026-09-13, that text contains "TAG" — so the old list reported a grading
 * label on a raw card and defeated the only gate the reader has.
 *
 * Run:  npx tsx scripts/psa-label-check.mts
 */

const GRADER = /\b(?:PSA|BGS|CGC|SGC|BECKETT)\b|\bgem\s*m(?:t|int)\b|\bnm[- ]?mt\b|\bpristine\b/i;

function finishFromLabel(text: string): string | undefined {
  if (!GRADER.test(text)) return undefined;
  if (/\brev(?:erse)?\b/i.test(text)) return "reverse";
  if (/\bnon[ -]?holo(?:foil)?\b/i.test(text)) return "normal";
  if (/\bholo(?:foil|graphic)?\b/i.test(text)) return "holo";
  return undefined;
}

/** [what a reader returns, what the printing key should be] */
const CASES: [string, string | undefined][] = [
  // Real label wording. Graders write the finish on the card line, and each
  // writes it differently — the reason these are patterns and not a lookup.
  ["2021 POKEMON SWSH CHAMPION'S PATH CHARIZARD VMAX-HOLO #074 GEM MT 10 PSA", "holo"],
  ["1999 POKEMON GAME PIKACHU-REVERSE HOLO #58 PSA MINT 9", "reverse"],
  ["2022 POKEMON SWSH SILVER TEMPEST FLETCHLING-REV FOIL #150 PSA 10", "reverse"],
  ["2016 POKEMON XY EVOLUTIONS MACHOP-NON HOLO #48 CGC 9.5", "normal"],
  ["2003 POKEMON EX RUBY & SAPPHIRE TREECKO REVERSE #66 BGS 9", "reverse"],
  ["2020 POKEMON VIVID VOLTAGE PIKACHU VMAX #044 SGC 10", undefined],

  // VISION'S OWN OUTPUT for two real PSA 10 slabs, read on 2026-09-13 — not
  // wording invented here, which only ever tests the pattern its author had in
  // mind. Both begin with the label and continue into the card face, because
  // that is what the reader returns; both are truncated at the point where the
  // rules text starts.
  //
  // Neither contains the word PSA. Both contain GEM MT. That is the whole
  // reason the gate reads the grade instead of the grader.
  //
  // The first writes the finish as "REV.FOIL", broken by a full stop rather
  // than the space every invented example above uses. Its label also says
  // FRENCH, and the card it resolves to is `dp2-94`, the English row — that is
  // the rule rather than a gap. A Western-language copy is a language option
  // inside one Cardmarket listing, not a product of its own, so the English
  // equivalent IS the answer; only the Asian printings are separate objects
  // with separate markets. The finish is a property of the cardboard and
  // survives the translation untouched.
  [
    "#94 GEM MT 10 70394249 2008 POKEMON D & P PIKACHU REV.FOIL MYSTERIOUS TREAS.FRENCH PA " +
      "Pikachu V.15 PV604 BASE NO. 025 Pokémon Souris",
    "reverse",
  ],
  [
    "2000 POKEMON PROMO MEW HOLO BLACK STAR #9 GEM MT 10 44731852 Basic Pokémon Mew 50 HPO " +
      "New Species Pokémon. Length: 1' 4\", Weight: 9 lbs.",
    "holo",
  ],

  // NEGATIVES. A raw card carries no grader marker, so nothing is read even
  // when the face happens to contain one of the finish words.
  ["Basic Pokemon REVERSE VALLEY Stadium each Pokemon takes 10 less damage", undefined],
  ["MEGA SABLEYE & TYRANITAR-GX TAG TEAM 280 HP Dangerous Stone GX", undefined],
  ["ACE SPEC Computer Search Trainer you may search your deck", undefined],
  ["Charizard VMAX 330 HP G-Max Wildfire Champion's Path 074/073", undefined],
];

let failures = 0;
for (const [text, expected] of CASES) {
  const got = finishFromLabel(text);
  const ok = got === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${String(got ?? "(silent)").padEnd(9)} expected ${String(expected ?? "(silent)").padEnd(9)} ${text.slice(0, 62)}`
  );
}

/**
 * AND THE ORDERING ITSELF, on the card the second slab holds.
 *
 * `dp2-94` Pikachu is stored `normal, reverse` — catalogue order, which is what
 * the scan renders when nothing says otherwise. The slab says REV.FOIL, so the
 * reverse has to lead. The other slab's Mew has ONE printing, and the right
 * behaviour there is to leave it alone rather than to have an opinion.
 */
type Print = { key: string };
function order(prints: Print[], text: string): string[] {
  const finish = finishFromLabel(text);
  if (!finish || prints.length < 2) return prints.map((p) => p.key);
  const named = prints.filter((p) => p.key === finish);
  if (named.length === 0) return prints.map((p) => p.key);
  return [...named, ...prints.filter((p) => p.key !== finish)].map((p) => p.key);
}

const ORDERING: [string, Print[], string, string[]][] = [
  [
    "dp2-94 Pikachu in the REV.FOIL slab",
    [{ key: "normal" }, { key: "reverse" }],
    "#94 GEM MT 10 2008 POKEMON D & P PIKACHU REV.FOIL MYSTERIOUS TREAS.FRENCH",
    ["reverse", "normal"],
  ],
  [
    "basep-9 Mew, one printing, nothing to choose",
    [{ key: "holo" }],
    "2000 POKEMON PROMO MEW HOLO BLACK STAR #9 GEM MT 10",
    ["holo"],
  ],
  [
    "the same card raw — no grader, so no opinion",
    [{ key: "normal" }, { key: "reverse" }],
    "Pikachu NIV.15 PV60 BASE Electro-recyclage BikeBika 94/123",
    ["normal", "reverse"],
  ],
];

for (const [what, prints, text, expected] of ORDERING) {
  const got = order(prints, text);
  const ok = got.join(",") === expected.join(",");
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${got.join(" -> ").padEnd(20)} expected ${expected.join(" -> ").padEnd(20)} ${what}`);
}

console.log(
  failures === 0
    ? `\n[psa-label] OK — ${CASES.length} cases, ${CASES.filter((c) => c[1] === undefined).length} of them silent by design.`
    : `\n[psa-label] ${failures} case(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
