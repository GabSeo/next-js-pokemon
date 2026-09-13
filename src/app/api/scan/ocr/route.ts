import { artDistance, artSignature, rarityFromText, referenceSignatures } from "@/lib/art-rank";
import { treatmentsInText } from "@/lib/one-piece-variants";
import { extractCardCodes } from "@/lib/card-code-ocr";
import { namesInText } from "@/lib/card-name-match";
import { japaneseName } from "@/lib/pokemon-ja-official";
import { pokemonSignature } from "@/lib/pokemon-art";
import { lookupCards } from "@/lib/card-lookup";
import { getCardView, type CardPrint, type CardView } from "@/lib/card-view";
import { readTextFromImage, visionConfigured, VisionNotConfiguredError } from "@/lib/vision";

/**
 * Read a card photo with Google Vision, for the codes the browser could not.
 *
 * THE SECOND ATTEMPT, NEVER THE FIRST. The scan page runs Tesseract on the
 * device first — free, unlimited, and the photo never leaves the phone. This
 * route is called only when that produced nothing, or produced something the
 * catalogue does not recognise. On the 5 of 6 real cards the client already
 * reads, Vision is never invoked and no unit is spent.
 *
 * That ordering is the whole cost design. 1,000 units/month is plenty for five
 * people with thirty cards each (~150 scans, total) precisely because most of
 * those scans never reach here.
 *
 * METERED, AND DECLARED AS SUCH. `vision.googleapis.com` has a ceiling in
 * lib/api-budget.ts, so `scripts/check-free-tier.mts` sees this route as
 * spending and requires it to be listed. That is correct rather than
 * unfortunate: the scan is a premium feature and this is the metered half of
 * it.
 *
 * NO ACCOUNT CHECK YET, deliberately and temporarily. Scanning becomes
 * account-gated at launch; today the site is unindexed, the audience is five
 * named people, and building an entitlement system for them would be the
 * over-engineering this project has been avoiding on purpose. `SCAN_SECRET`
 * below is the whole lock: set it and the route requires it, leave it unset and
 * the route is open. When accounts exist, this check is what they replace.
 *
 * The image is read and discarded. Nothing is written to disk and nothing is
 * logged from it.
 */

export const runtime = "nodejs";

/**
 * What is wrong with the key, without ever showing it.
 *
 * Added because diagnosing this by guesswork was costing more than the feature.
 * The 501 the POST returns says only "not configured", which is true for a
 * missing variable and indistinguishable from one that is present but
 * unusable — a truncated paste, a value scoped to the wrong environment, or a
 * PEM whose newlines an editor turned into the characters backslash-n.
 *
 * Everything below is a SHAPE, never a value: whether the variable exists, how
 * long it is, whether it parses, and whether the two fields that matter are
 * present. `client_email` is reported as its domain only, which identifies the
 * project without exposing the account. The private key is reported as a length
 * and a yes/no on looking like a PEM. None of it is a secret, and all of it is
 * enough to tell the four failure modes apart in one request.
 */
export function GET() {
  const raw = process.env.GOOGLE_VISION_KEY;

  if (!raw) {
    return Response.json({
      configured: false,
      problem: "GOOGLE_VISION_KEY is not present on this deployment.",
      likely:
        "The variable exists in Vercel but is not ticked for this environment " +
        "(a branch deploys to Preview, not Production), or it was added after " +
        "this deployment was built. Tick Preview, then redeploy.",
    });
  }

  // Same acceptance as lib/vision.ts: raw JSON, or base64 of it.
  const trimmed = raw.trim();
  const decoded = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");

  let parsed: { client_email?: string; private_key?: string; private_key_id?: string };
  try {
    parsed = JSON.parse(decoded) as typeof parsed;
  } catch {
    return Response.json({
      configured: false,
      length: raw.length,
      encoding: trimmed.startsWith("{") ? "looks like raw JSON" : "not JSON — tried base64 and that failed too",
      problem: "Present, but unreadable.",
      likely:
        raw.length < 200
          ? "Too short to be a service-account file — this looks like a single field (a private_key_id or an API key) rather than the whole JSON."
          : "The paste may be truncated. Copy the entire downloaded .json, braces included.",
    });
  }

  const key = parsed.private_key ?? "";
  return Response.json({
    configured: Boolean(parsed.client_email && parsed.private_key),
    length: raw.length,
    hasClientEmail: Boolean(parsed.client_email),
    // Domain only: identifies the project, exposes no account.
    emailDomain: parsed.client_email?.split("@")[1] ?? null,
    hasPrivateKey: Boolean(parsed.private_key),
    privateKeyLength: key.length,
    privateKeyLooksLikePem: key.includes("BEGIN PRIVATE KEY"),
    // The one mangling that is common and silent.
    privateKeyHasLiteralBackslashN: key.includes("\n"),
    problem:
      parsed.client_email && parsed.private_key
        ? null
        : parsed.private_key_id && !parsed.private_key
          ? "This has private_key_id but no private_key — it is not the full service-account file."
          : "Missing client_email or private_key.",
  });
}

/** Vision's own hard limit is 20 MB base64; a phone photo is 2–6 MB and a card needs far less. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POKEMON: THE FINISH, WHEN A GRADING LABEL STATES IT.
 *
 * WHY IT IS A SEPARATE FUNCTION AND NOT A BRANCH OF rankPrintings. That one
 * orders by ARTWORK, and Pokemon has none to order by — 0 of 10,110
 * multi-variant cards have a distinct image, which is exactly why it excludes
 * Pokemon in its first line. A normal and its reverse holo are the same
 * picture. No amount of looking will ever separate them, so a picture-based
 * ranker has nothing to contribute and this one never touches a signature.
 *
 * WHAT IS AT STAKE. 9,321 English and Japanese cards carry more than one
 * finish — 20.7% of the catalogue — and 7,906 of those are the normal/reverse
 * pair, where the reverse is worth a median 3.36x its twin (see CardPrint's own
 * comment). Today the scan shows both tiles in catalogue order and says nothing
 * about which one is in the reader's hand, on a difference that large.
 *
 * ONLY FROM A GRADING LABEL, and that is the whole safety argument rather than
 * a limitation. A raw Pokemon card does not say "reverse" anywhere on it: the
 * finish is a property of the cardboard, not of anything printed on it. So the
 * only place these words legitimately appear in what a reader returns is a
 * slab's label. Requiring the grader's own marker before trusting them turns a
 * dangerous free-text match into a narrow one — and costs nothing, because
 * there is no other case where the evidence exists at all.
 *
 * THE RESIDUAL RISK IS NAMED rather than waved away: a slab's OCR carries the
 * card FACE as well as the label, so a card whose own wording contains one of
 * these words could mislead it. Measured against every English card name, that
 * is one card in 21,066 — "Reverse Valley". The cost there is two
 * identical-looking tiles in the wrong order, which a person fixes by looking.
 * Nothing is ever dropped.
 *
 * REVERSE IS TESTED BEFORE HOLO, because "REVERSE HOLO" contains "HOLO" and
 * matching the shorter one first would call every reverse a holo — the same
 * longest-first rule rarityFromText already follows for SEC against SR.
 *
 * VERIFIED against Vision's own output for two real PSA slabs, in
 * scripts/psa-label-check.mts.
 */
/**
 * Is this text a grading label at all?
 *
 * THE GRADE, NOT THE GRADER, and getting that backwards made the first version
 * of this useless. It asked for the company's name — and measured against the
 * reader's real output for two PSA 10 slabs, `\bPSA\b` is FALSE on both. PSA
 * sets its own name as a stylised logo, so there is no text there to read. What
 * IS read, on both, is `GEM MT`: the grade, spelled the way the grading scale
 * spells it.
 *
 * That turns out to be the safer half anyway. A grade phrase describes the
 * SLAB, so it has no reason to appear on a card, and none of the five below
 * occurs in any of the 44,985 card names in either catalogue. A company name
 * can collide — which is the second thing this gate got wrong.
 *
 * TAG Grading and ACE Grading are deliberately absent. Pokemon prints
 * "TAG TEAM" and "ACE SPEC" on the face of real cards — the first is legible on
 * megasableye-tyranitargx-226-236.jpg in img test/, and Vision does read "TAG"
 * out of it — so listing TAG here reported a grading label on a raw card and
 * defeated the only gate this reader has. The catalogue cannot measure that
 * risk, since it stores names rather than the words printed on a card, which is
 * a reason to be more careful here rather than less.
 *
 * Bare "MINT" is left out on the same principle even though it collides with
 * nothing today: it is one word away from ordinary English, and the four-plus-
 * company list already catches every slab tested.
 */
const GRADER = /\b(?:PSA|BGS|CGC|SGC|BECKETT)\b|\bgem\s*m(?:t|int)\b|\bnm[- ]?mt\b|\bpristine\b/i;

/** The finish a grading label names, or nothing. */
function finishFromLabel(text: string): string | undefined {
  if (!GRADER.test(text)) return undefined;
  // "REVERSE", and the "REV FOIL" graders abbreviate to. The trailing word is
  // deliberately not required: the finish is already decided by this point, and
  // demanding "HOLO" after it would miss every label that writes "REV FOIL".
  if (/\brev(?:erse)?\b/i.test(text)) return "reverse";
  if (/\bnon[ -]?holo(?:foil)?\b/i.test(text)) return "normal";
  if (/\bholo(?:foil|graphic)?\b/i.test(text)) return "holo";
  return undefined;
}

/**
 * Move the printing the label names to the front. Never drops, never reorders
 * anything else.
 *
 * A stable partition rather than a sort: everything this cannot name keeps the
 * order the catalogue gave it, so a label that says nothing about the finish
 * leaves the card exactly as it was.
 */
function orderPokemonPrintings(cards: CardView[], text: string): void {
  const finish = finishFromLabel(text);
  if (!finish) return;
  for (const card of cards) {
    if (card.tcg !== "pokemon" || card.prints.length < 2) continue;
    const named = card.prints.filter((print) => print.key === finish);
    if (named.length === 0) continue;
    card.prints = [...named, ...card.prints.filter((print) => print.key !== finish)];
  }
}

/**
 * WHAT THE CARD SAYS ABOUT WHICH PRINTING IT IS — a set, a treatment, or both.
 *
 * THE PROJECT'S OWN RULE, APPLIED ONE LEVEL DOWN. "The artwork is a guess; the
 * printed number is evidence" is why this route reads the code before it looks
 * at a picture. Between PRINTINGS of that code the same rule was abandoned: the
 * ordering went straight to artwork distance while the reader's own output sat
 * unread. It is not always there — but when it is, it is not a resemblance.
 *
 * A GRADED SLAB STATES IT OUTRIGHT. Measured on a real PSA photograph in
 * img test/, Vision returns:
 *
 *   2024 ONE PIECE PRB01 EN
 *   MONKEY D. LUFFY
 *   ALTERNATE ART
 *
 * That is the set and the treatment, in words, on a card whose five printings
 * the artwork could not separate — it put the base print first and the right
 * one second.
 *
 * THE CARD'S OWN CODE IS REMOVED FIRST, and skipping that would break every
 * card rather than fix one: `OP01-024` contains the token `OP01`, so a naive
 * reader finds a "set" on every card ever printed and always the wrong one —
 * the set a code BELONGS to, never the set a copy was PRINTED in. A reprint's
 * whole nature is that those differ. What survives the strip is a set named by
 * something other than the number, which is exactly a slab label or a set name
 * printed on the face.
 *
 * IT CANNOT INVENT, ONLY CHOOSE, which is what makes reading free text safe
 * here. Every term is matched against printings this card already has, so a
 * hallucinated "GOLD" off a foil selects nothing on a card with no Gold
 * printing and the ranking is exactly what it would have been. See
 * treatmentsInText's own comment for why that guarantee has to live at the
 * caller.
 */
function printedEvidence(text: string, code: string): { sets: string[]; treatments: string[] } {
  const stripped = text.replace(new RegExp(code.replace("-", "[- ]?"), "gi"), " ");
  const sets = [
    ...new Set((stripped.toUpperCase().match(/\b(?:OP|EB|ST|PRB)[- ]?\d{2}\b/g) ?? []).map((m) => m.replace(/[- ]/, ""))),
  ];
  return { sets, treatments: treatmentsInText(stripped) };
}

/** How many independent printed facts this printing satisfies. Never negative. */
function evidenceFor(print: CardPrint, found: { sets: string[]; treatments: string[] }): number {
  const bare = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // `origin` is Bandai's pack code — "PRB-01", or "JP · PRB-01" — so the
  // punctuation has to go before "PRB01" can match it.
  const set = found.sets.some((s) => bare(print.origin).includes(bare(s)));
  // A label is "Alternate Art" or "SP · Gold"; the vocabulary's ids are
  // "alternate-art" and "sp"/"gold". Same words, different spelling.
  const label = (print.label ?? "").toLowerCase().replace(/\s*·\s*/g, " ").replace(/\s+/g, "-");
  const treatment = found.treatments.some((t) => label.includes(t));
  return (set ? 1 : 0) + (treatment ? 1 : 0);
}

/**
 * THERE IS NO CAP ANY MORE, and the one that was here cost the ranking exactly
 * where it was worth most.
 *
 * `MAX_RANKED_PRINTINGS = 10` skipped any card with more than ten printings —
 * 30 codes, and they are the chase cards, the ones a person photographs
 * BECAUSE they have sixteen versions at wildly different prices. OP05-119 has
 * twelve, so a real scan of it was never ranked at all and rendered in
 * catalogue order under a caption promising otherwise.
 *
 * The cost it was guarding against no longer exists. It was written when this
 * function FETCHED AND HASHED each reference image per scan — seven sequential
 * 250 KB downloads for a seven-printing card, which was the whole "works great
 * but very slow". Signatures are precomputed on disk now and read once per
 * process, so one comparison is 0.24 microseconds: the six the cap saved on a
 * sixteen-printing card were worth 0.001 ms between them.
 *
 * Measured on a real photograph of OP05-119 (a French holo, in img test/), the
 * ranking the cap was suppressing is simply right:
 *
 *   0.359  Alternate Art · PRB-01   <- the card in hand, confirmed by its owner
 *   0.382  (base) · JP · PRB-01
 *   0.411  2nd Anniversary Set
 *
 * The loop below still guards itself — a missing signature still abandons the
 * card rather than ranking it half — and measured across all 1,267
 * multi-printing codes, that path now fires zero times.
 */

/**
 * Reorder each card's printings so the one that looks like the photo comes
 * first, and drop the ones whose rarity the photo contradicts.
 *
 * ONE PIECE ONLY. Pokémon printings share their artwork — 0 of 10,110
 * multi-variant cards have a distinct image — so there is nothing to compare and
 * catalogue order is already the right order.
 *
 * Mutates in place and never throws: an unreadable image, a reference that will
 * not fetch, or a rarity that matches nothing all leave the list exactly as the
 * catalogue gave it. A worse ordering is a small loss; a failed scan is not.
 */
async function rankPrintings(cards: CardView[], image: Buffer, text: string): Promise<void> {
  const photo = await artSignature(image);
  if (!photo) return;

  const rarity = rarityFromText(text);
  const english = referenceSignatures("english");
  const japanese = referenceSignatures("japanese");
  if (english.size === 0 && japanese.size === 0) return;

  for (const card of cards) {
    if (card.tcg !== "onepiece") continue;
    if (card.prints.length < 2) continue;

    // Precomputed, read from disk once per process. This used to fetch and hash
    // each reference image per scan -- seven sequential 250 KB downloads for a
    // seven-printing card, which was the entire "works great but very slow".
    const scored: { print: CardPrint; distance: number }[] = [];
    const unpictured: CardPrint[] = [];
    let gap = false;

    for (const print of card.prints) {
      // A printing nobody has published a picture of cannot be compared to a
      // photograph, and that is not a coverage gap — 139 promo printings are
      // named by the mirror and pictured by no one. Sorting them last is the
      // honest place for them: they stay reachable, and they cannot win a
      // comparison they never entered.
      if (!print.image) {
        unpictured.push(print);
        continue;
      }

      // A print whose key is `<printingId>~<product>` is a separate product
      // that the mirror points at an existing printing's picture — a Jumbo, an
      // oversized event print. It has no signature of its own because it has no
      // artwork of its own, so it is compared using the picture it shares.
      const base = print.key.includes("~") ? print.key.slice(0, print.key.indexOf("~")) : print.key;
      const signature = english.get(print.key) ?? japanese.get(print.key) ?? english.get(base) ?? japanese.get(base);
      // A printing that HAS a picture and no signature is a real gap in the
      // catalogue. Ranking the rest would quietly promote whichever printings
      // happened to be covered, so the card keeps catalogue order instead.
      if (!signature) {
        gap = true;
        break;
      }
      scored.push({ print, distance: artDistance(photo, signature) });
    }

    if (gap || scored.length < 2) continue;

    // Rarity BOOSTS, it does not filter, and the difference matters. Vision read
    // both "SP" and "SR" off one real card; had the wrong one won, filtering
    // would have deleted the correct printing from the list entirely and left
    // the person unable to choose it. A misread now costs ordering, which is
    // recoverable by looking, rather than availability, which is not.
    //
    // The bonus is deliberately larger than the widest observed artwork gap
    // (0.206 across seven printings), so a rarity match leads — but everything
    // stays on screen.
    // PRINTED EVIDENCE OUTRANKS RESEMBLANCE, on the same scale as the rarity
    // bonus and for the same reason: both are things the card SAYS, and the
    // artwork gap they have to beat is 0.206 at its widest. Two facts agreeing
    // (a set AND a treatment) beat one, and a printing the text says nothing
    // about keeps its artwork distance untouched.
    const printed = printedEvidence(text, card.code);

    /**
     * A FACT THAT MOST PRINTINGS SHARE IS NOT EVIDENCE ABOUT ANY OF THEM.
     *
     * The bonus is a whole point, far larger than any artwork gap, which is
     * right when a rarity picks ONE printing out of twelve and wrong when it
     * picks seven. Measured on a photographed Wanted Poster OP05-119: its
     * corner reads SEC, seven of its twelve printings are SecretRare, and the
     * Wanted Poster is not one of them — it is Special. So a bonus meant to
     * discriminate rewarded the majority and pushed the card in hand from
     * second place to seventh, behind six printings it does not look like.
     *
     * Requiring a strict minority is the cheapest honest test: a fact that
     * separates nothing gets no weight, and one that separates a few keeps the
     * full bonus it has earned. Nothing is filtered either way — see below.
     */
    const sharing = scored.filter((entry) => entry.print.rarity === rarity).length;
    const rarityDiscriminates = rarity !== undefined && sharing > 0 && sharing * 2 < scored.length;

    /**
     * THE LANGUAGE ON THE CARD, WHICH THE ARTWORK CANNOT SEE.
     *
     * A Japanese printing and its Western release are the same picture. The
     * signature therefore cannot tell them apart, and on a photographed Wanted
     * Poster OP05-119 it put `JP · OP-09` at 0.309 ahead of the English OP-09
     * at 0.383 — a card whose every sentence Vision read in English.
     *
     * Rules text is evidence the picture does not carry. BOTH DIRECTIONS ARE
     * POSITIVE, which is the lesson from the catalogue-language bug above:
     * kana present says Japanese, and a page of Latin words says Western.
     * Neither is inferred from the other's absence, so an OCR that reads
     * nothing says nothing and the artwork keeps its verdict. Measured:
     *
     *   FR card 44 Latin words   EN card 42   EN slab 34   Wanted Poster 40
     *   JA card whose OCR failed  0
     *
     * The threshold sits far below every Western sample and far above the
     * failed one, so it is a gap rather than a fitted constant.
     *
     * A PENALTY, NOT A FILTER, like everything else here: the mismatched
     * printing stays on screen and stays reachable, it simply stops leading.
     */
    const westernText = (text.match(/[A-Za-zÀ-ÿ]{4,}/g) ?? []).length >= 12;
    const japaneseText = JAPANESE_SCRIPT.test(text);

    for (const entry of scored) {
      if (rarityDiscriminates && entry.print.rarity === rarity) entry.distance -= 1;
      entry.distance -= evidenceFor(entry.print, printed);
      const isJapanesePrint = entry.print.origin.startsWith("JP ");
      if (japaneseText !== isJapanesePrint && (japaneseText || westernText)) entry.distance += 1;
    }

    scored.sort((a, b) => a.distance - b.distance);
    card.prints = [...scored.map((s) => s.print), ...unpictured];
  }
}

/** Kana and kanji. Latin-only text has none; a Japanese card face is full of them. */
const JAPANESE_SCRIPT = /[぀-ゟ゠-ヿ一-鿿]/;

/**
 * Put the candidate that best matches what Vision actually read first.
 *
 * WHY ORDERING IS THE ANSWER. What is printed on a Pokemon card is `048/082` —
 * a number and a set size, never the set, which is carried by a symbol no OCR
 * reads. 154 of 216 English sets share their printed total with another English
 * set and 152 of 182 Japanese ones do, so one photographed number genuinely
 * names several cards. The scan shows the FIRST as "your card", so the order is
 * the answer, and both signals below were already in hand and thrown away.
 *
 * THE NAME, the stronger of the two: a candidate whose name appears in the text
 * Vision returned is the card, not a card with the same number. The Japanese
 * corpus holds names AS PRINTED for exactly this — the labels on screen stay
 * romanised, but `ゲンガーex` is what the camera sees.
 *
 * THE SCRIPT, for the 4,330 Japanese cards no source names in Japanese: a card
 * face written in kana is not an English Team Rocket card.
 *
 * ORDERS, NEVER FILTERS — the same rule as the rarity boost. Vision misreads,
 * cards carry both scripts, and a card can be photographed beside other text. A
 * wrong guess costs position, which a person can see past; filtering would cost
 * availability, which they cannot.
 */
function orderCandidates(cards: CardView[], text: string): void {
  const japanese = JAPANESE_SCRIPT.test(text);
  const haystack = text.toLowerCase();

  const rank = (card: CardView): number => {
    // 0 — the name Vision read is this card's name, in either spelling.
    const printed = card.tcg === "pokemon" ? japanesePrintedName(card.code) : undefined;
    if (printed && text.includes(printed)) return 0;
    const name = card.name?.trim();
    if (name && name.length >= 2 && (text.includes(name) || haystack.includes(name.toLowerCase()))) return 0;
    if (card.tcg !== "pokemon") return 1;
    // 1 — written in the script Vision read. 2 — written in the other one.
    return card.code.startsWith("ja~") === japanese ? 1 : 2;
  };

  // Stable: equal ranks keep the order the catalogue gave them.
  cards.sort((a, b) => rank(a) - rank(b));
}

/**
 * The name printed on a Japanese card, for a `ja~<tcgdexId>` code.
 *
 * The catalogue romanises it and the UI keeps that romanisation; this is the
 * spelling the camera actually sees, and it lives here rather than on screen.
 */
function japanesePrintedName(code: string): string | undefined {
  if (!code.startsWith("ja~")) return undefined;
  const id = code.slice(3);
  const dash = id.lastIndexOf("-");
  if (dash <= 0) return undefined;
  return japaneseName(id.slice(0, dash), id.slice(dash + 1));
}

/**
 * Order the Pokemon candidates by how much each LOOKS like the photograph.
 *
 * WHY THIS IS THE RIGHT SIGNAL. What is printed on a Pokemon card is `048/082`
 * — a number and a set size, never the set, which is carried by a symbol no OCR
 * reads. 154 of 216 English sets share their printed total with another English
 * set, so one photographed number genuinely names several cards. Until now the
 * only thing separating them was the script the text was written in, which
 * answers "which catalogue" and not "which card".
 *
 * ALL OR NOTHING, like the One Piece ranker and for the same reason: a
 * candidate with no signature cannot lose a comparison it never entered, so
 * ranking a partial set would quietly promote whichever cards happen to be
 * covered. 4,330 Japanese cards are pictured nowhere public; when one of them
 * is a candidate, the whole group keeps the order the name and script gave it.
 *
 * THE CARD, NEVER THE PRINTING. 0 of 10,110 multi-variant Pokemon cards have a
 * distinct image, so this cannot tell a normal from its reverse holo. That is
 * Vision's job, once, on confirmation.
 */
async function rankPokemonCards(cards: CardView[], image: Buffer): Promise<void> {
  const pokemon = cards.filter((card) => card.tcg === "pokemon");
  if (pokemon.length < 2) return;

  // Every candidate first: one unsigned card leaves the whole group alone.
  const signatures = pokemon.map((card) => pokemonSignature(card.code));
  if (signatures.some((signature) => signature === undefined)) return;

  const photo = await artSignature(image);
  if (!photo) return;

  const scored = pokemon
    .map((card, index) => ({ card, distance: artDistance(photo, signatures[index]!) }))
    .sort((a, b) => a.distance - b.distance);

  // Rewrite only the Pokemon slots, in place, so One Piece candidates keep the
  // position `orderCandidates` gave them.
  const ordered = scored.map((entry) => entry.card);
  let next = 0;
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].tcg === "pokemon") cards[i] = ordered[next++];
  }
}

export async function POST(request: Request) {
  if (!visionConfigured()) {
    // 501, not 500: nothing is broken, the feature simply is not set up. The
    // client treats this as "stay with what the browser read".
    return Response.json(
      { error: "Vision is not configured on this deployment." },
      { status: 501 }
    );
  }

  // Optional shared secret. Unset means open, which is the current intent.
  const required = process.env.SCAN_SECRET;
  if (required && request.headers.get("x-scan-secret") !== required) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return Response.json(
      { error: "POST the image bytes with an image/* Content-Type." },
      { status: 415 }
    );
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return Response.json({ error: "Empty body." }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json(
      { error: `Image too large: ${Math.round(bytes.byteLength / 1024)} KB, limit ${MAX_BYTES / 1024} KB.` },
      { status: 413 }
    );
  }

  const image = Buffer.from(bytes);

  try {
    const text = await readTextFromImage(image);
    // The SAME extractor the client uses. An engine swap must not change what
    // counts as a card code, and this one is measured against real OCR noise.
    const candidates = extractCardCodes(text);

    // Resolve to real cards here rather than in a second round trip: the photo
    // is already uploaded, and asking the client to send it twice to rank the
    // printings would double the slowest part of the scan.
    /**
     * KANA IS EVIDENCE. ITS ABSENCE IS NOT.
     *
     * A face written in kana is not an English card, and scoping on that is
     * worth keeping: it halves the candidates and removes a whole class of
     * wrong answer — a photographed Japanese Lugia was returning Kangaskhan,
     * because S12 and SV10 both declare 98 cards and both have a 110. 53% of
     * English and 57% of Japanese printed numbers name more than one card.
     *
     * The other half of that line was an assumption dressed as a deduction.
     * `: "en"` read "no kana was found" as "this is an English card", when what
     * it actually means is "no kana was READ" — and Vision does not always read
     * it. Measured on 2026-09-13 for img test/pokemon japanese/aerodactyl
     * v 106-100.jpg, a card whose face is entirely Japanese, Vision returned
     *
     *   ta | *755V | DA | MP | 210 | 40 | 120 | S
     *
     * with not one kana in it. The number came back perfectly — "106/100" —
     * and was then looked up in the English catalogue, which has no 100-card
     * set with a 106. The scan told its owner "no card in the catalogue has
     * that number" about a card whose page it can render.
     *
     * WHAT IT COSTS TO STOP ASSUMING, measured across the twelve numbers in
     * img test/: four are findable ONLY this way — every Japanese one, all
     * returning nothing under "en" — and eight English ones widen by between
     * zero and five candidates.
     *
     * That widening is not a regression, it is the case `rankPokemonCards`
     * below exists for: the number says which number, the artwork says which
     * set. An extra candidate it can order is a better outcome than a right
     * answer that was never a candidate.
     */
    const language = JAPANESE_SCRIPT.test(text) ? "ja" : undefined;

    const cards: CardView[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      for (const match of lookupCards(candidate.value, undefined, language).matches.slice(0, 6)) {
        const id = `${match.tcg}:${match.code}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const view = await getCardView(match.tcg, match.code);
        if (view) cards.push(view);
      }
    }

    // NO CODE RESOLVED. A blurred or cropped number leaves nothing to look up,
    // but the name is usually the largest text on the card and survives. This
    // runs only in that case: when a number DID resolve, the name is used to
    // order those candidates rather than to invent more.
    //
    // AND THE CALLER IS TOLD IT HAPPENED. These cards were chosen because they
    // share a NAME, which for a Pikachu means an arbitrary six of the 166 that
    // exist — the photographed one is very likely not among them. Rendered
    // under the same heading as a resolved number, that reads as six confident
    // answers; observed exactly that way on a Galarian Gallery Pikachu, whose
    // number the extractor could not parse at the time.
    //
    // The cards are still returned, because a name is real evidence and one of
    // them may be right. What changes is that the page can now say which kind
    // of answer it is holding.
    let byNameOnly = false;
    if (cards.length === 0) {
      for (const hit of namesInText(text)) {
        for (const match of lookupCards(hit.name, undefined, language).matches.slice(0, 6)) {
          const id = `${match.tcg}:${match.code}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const view = await getCardView(match.tcg, match.code);
          if (view) cards.push(view);
        }
      }
      byNameOnly = cards.length > 0;
    }

    orderCandidates(cards, text);
    await rankPokemonCards(cards, image);
    await rankPrintings(cards, image, text);
    orderPokemonPrintings(cards, text);

    return Response.json({ text, candidates, cards, byNameOnly });
  } catch (error) {
    if (error instanceof VisionNotConfiguredError) {
      return Response.json({ error: "Vision is not configured." }, { status: 501 });
    }
    // Budget exhausted, a refused key, a network fault. All the same to the
    // client, which falls back to what the browser read or to typing.
    const message = error instanceof Error ? error.message : "Vision failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
