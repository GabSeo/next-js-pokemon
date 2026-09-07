# The free catalogue, the scan, and where money starts

**Status: plan of record.** Written 2026-09-07. Supersedes the "Implication"
half of `docs/scan-to-collection.md`, which reasoned toward this from a smaller
evidence base; that document's *Measured* sections remain the source for the
finding this whole design is built on.

The product goal: **a person photographs a card, picks which printing they own,
and it lands in their collection. Free. Market data — eBay, Cardmarket,
TCGplayer, price history — is what they pay for.**

---

## 1. The constraint everything is designed around

We proved this twice, independently, and it is not a limitation to engineer
around — it is the shape of the domain.

**A card code identifies a card. It does not identify a collectible.**

`ST21-014` returns four real printings. All four are SR, all four are Monkey D.
Luffy, all four are Red / cost 5 / power 6000 / Strike. They trade at **USD
1,747.19, 29.51, 8.67 and 8.58** — a 204× spread. Every field a scanner can
read off the card is identical across all four.

And the official source is no better. Measured 2026-09-06 across Bandai's own
published catalogue:

| | |
|---|---|
| (code, pack) groups holding more than one printing | 945 |
| of those, identical in **every field** but the id and the image URL | **895 (94.7%)** |
| groups where `name` differs | **0** |
| tracked cards identifiable from (code + pack + treatment) | **0 of 9** |

Bandai records *that* a code has three printings. It does not record *which* is
the Alternate Art, the Manga or the Reprint. That distinction exists only in the
picture.

### What follows

1. **No pipeline can pick the printing automatically.** Not from a scan, not
   from a code, not from any catalogue we have found. Anything claiming to is
   guessing, and a wrong guess is a 204× error in a user's collection total.
2. **So the human picks — and the product is built around that step, not in
   spite of it.** A scan narrows 34,000 cards to three or four candidates. The
   person then answers a question only they can: *which of these is the one in
   your hand?* That is a two-second tap, and it is the only correct answer.
3. **The unit of everything downstream is a PRINT IDENTITY**, not a code:
   `(tcg, code, printing)`. Collections, prices and metrics all key on it.

---

## 2. The two planes

The free/paid split is not a business decision bolted onto the architecture. It
falls out of which sources are metered.

| | IDENTITY plane | MARKET plane |
|---|---|---|
| **Answers** | what is this card | what is it worth |
| **Pokémon** | TCGdex → `data/catalog/pokemon/` | apitcg, PokéWallet, eBay |
| **One Piece** | punk-records → `data/catalog/one-piece-official/`<br>BerryWallet corpus → `data/catalog/one-piece/` | BerryWallet live, apitcg, eBay |
| **Cost per user** | **zero** — files on disk | metered, per card |
| **Who gets it** | everyone | subscribers |
| **Changes** | when a set releases | continuously |

Identity is already free and local for both franchises. That work is done. The
plan below is about *exposing* it to users who are not paying, without letting a
single metered call leak into their path.

### The rule, stated once

> A page a free user can reach must be renderable with **zero metered calls**.
> Market data is an explicit, per-card, gated action.

---

## 3. What violates that rule today

Three things, found while writing this. The first is live.

### a. One Piece card images are metered

`lib/berrywallet.ts`'s `fetchCardImage` passes `RATE_LIMIT_BUCKET` to
`resilientFetch`, so **every image charges the 90/hour BerryWallet budget**. A
candidate grid showing nine printings of a scanned card would spend nine calls,
for a free user, on a picture.

This is the single blocking issue for the scan flow.

**Fix**: serve One Piece images from Bandai's URLs, which `punk-records` gives
us for all 12,720 printings, through our own proxy. Bandai sets
`Cross-Origin-Resource-Policy: same-site`, so a browser will not load them from
our domain directly — but a *server* fetch is unaffected (verified: 200,
212 KB). The proxy pattern already exists for BerryWallet; this is the same
route pointed at a free source.

### b. There is no free per-card page

`/products/[slug]` is the tracked-card page and resolves everything eagerly:
identity, Cardmarket, TCGplayer, eBay tiers, history. It exists for 12 refs. A
free user scanning any of 21,066 Pokémon cards or 2,785 One Piece codes has
nowhere to land that is safe.

### c. Nothing enforces the boundary

The tier-1 discipline (`lib/catalog.ts` and friends import `node:fs` and
nothing else) is real but only covers the loaders. Nothing stops a future page
importing `cards.ts` and quietly putting a metered call on a free route.

---

## 4. The pipeline

```
  CAPTURE          photo, or the card code typed by hand
     ↓
  READ             extract the code — client-side OCR, zero server cost
     ↓
  MATCH            code → every printing of it, from local catalogue, 0 calls
     ↓
  CHOOSE           a visual grid; the person taps the one they own
     ↓
  STORE            collection row = (tcg, code, printingId)
     ↓
  ─────────────────  paywall  ─────────────────
     ↓
  ENRICH           eBay tiers, Cardmarket, TCGplayer, history — per card, gated
```

### Why code-first and not image-similarity

The code is a short, fixed-format, high-contrast string printed in a known
position on every card in both games. It is the easiest thing on the card to
read and the most discriminating: it narrows 34,000 cards to typically 1–9.

Image similarity would need an embedding per printing and a vector index — and
it would still land on the same *choose* step, because reprints of one code are
often the same artwork. It is a **Phase 6 accelerator**, not a foundation.

### Why OCR runs on the client

GCP Vision's free tier is 1,000 units/month — about 33 scans a day across all
users (`GCP-CONTEXT.md` §4.8). That cannot serve a free tier. Client-side OCR
(Tesseract.js or the browser's own `TextDetector` where available) costs us
nothing per scan and scales with users rather than against them.

And there is always a floor that cannot fail: **typing `OP05-119` reaches the
same matcher.** The scan is a convenience over the keyboard, so a bad photo
degrades to a text field rather than to an error.

---

## 5. The phases

Each is independently shippable and independently useful. None requires the
next. None touches the eBay/Cardmarket/TCGplayer pipeline.

### Phase 0 — Guard rails *(no user-visible change)*

Make the boundary enforceable before building on it.

- A build check, in the shape of `check-one-piece-vocabulary.mts`: assert that
  no route reachable by a free user imports a metered module (`cards.ts`,
  `berrywallet.ts`, `pokewallet.ts`, `apitcg.ts`, `ebay-*`).
- Wire it into `prebuild`, so the failure is a red build rather than a quota
  incident.

**Exit criteria**: the check passes today and fails if you add such an import.

### Phase 1 — Unmetered One Piece images

- `/api/one-piece-image/[printingId]` — resolves the Bandai URL from
  `data/catalog/one-piece-official/`, fetches server-side, serves with
  `Cache-Control: immutable`.
- Thumbnail variant for grids. Bandai's files are 200–250 KB; a 319-tile page
  at full size is ~80 MB and untenable.
- Point `/sets/onepiece/[packId]` at it, replacing the text-only tiles.

**Exit criteria**: a set page renders every card image, with zero metered calls.
Measured against `npm run` + the budget report before and after.

### Phase 2 — Free catalogue card pages

- `/card/[tcg]/[code]` — every printing of a code, side by side: image, name,
  rarity, set/pack, and for One Piece the treatment from the BerryWallet corpus.
- Reads only tier-1 loaders. No prices, and it says so.
- This is both the scan's landing page and a browsable destination in its own
  right, so it is worth building before the scanner exists.

**Exit criteria**: `/card/one-piece/OP05-119` shows all printings; the budget
report is unchanged after loading it.

### Phase 3 — Lookup by code *(the scan without the camera)*

- A search box that accepts `OP05-119`, `190/182`, or a name.
- Routes to the Phase 2 page.
- Ships the whole *match → choose* interaction with no OCR risk.

**Exit criteria**: a person can find any of 34,000 cards and pick a printing.

### Phase 4 — Scan

- Camera capture → client-side OCR → extract code → same route as Phase 3.
- On low confidence, show the text field pre-filled with the best guess.

**Exit criteria**: scanning a card lands on its printing grid; a failed read
degrades to typing, never to an error.

### Phase 5 — Collection (free)

- A collection row is a **print identity**: `(tcg, code, printingId, quantity,
  condition, acquiredAt)`.
- Identity-level display only — name, image, set, printing. No value.
- The absence of a total is the paywall, stated honestly rather than teased.

**Exit criteria**: add, list and remove cards, with zero metered calls.

### Phase 6 — Market activation *(paid)*

- A subscriber activates market data on a specific card.
- That, and only that, calls the existing pipeline — untouched.
- Activation is what `card-refs.ts` encodes by hand today: it becomes a row in a
  table rather than a commit.

**Exit criteria**: a free user cannot cause a metered call. A subscriber's
activation produces exactly the data `/products/[slug]` shows today.

---

## 6. The open question that Phase 6 turns on

**For One Piece, the identity plane and the market plane use different ids, and
we have not proved they can be joined.**

- `punk-records` gives images, languages and gameplay data, keyed `OP05-119_p4`.
- The BerryWallet corpus gives the treatment (`(Alternate Art) (Manga)`) and the
  Cardmarket/TCGplayer URLs that lead to money, keyed by its own row id.
- A user picking from a *picture* gives us a punk-records id. Pricing it needs
  the BerryWallet row.

There is a promising signal — for OP05-119 in PRB-01, BerryWallet holds three
rows and Bandai holds three printings — but "same count, therefore same order"
is exactly the `(V.N)` assumption this codebase already refuses to make twice
over.

**How to resolve it**: before Phase 6, measure across all codes present in both
catalogues — how often do the counts agree, and where they do, does any
independent signal (rarity, pack, price tier) confirm the alignment? If the
answer is no, the join is a human step too, done once per card at activation,
which is acceptable because activation is already a deliberate act.

**Do not build Phase 6 on an assumed join.**

---

## 7. What must not break

The market pipeline is the hardest-won part of this codebase and none of the
above touches it:

- `lib/one-piece-variants.ts` — the four-axis query model (treatment, product,
  rarity, spelling), every rule of it measured against live eBay.
- `data/one-piece-sets.ts` — the vocabulary tables, and the build gate that
  fails when a tracked card's query cannot separate its own printings.
- `lib/graded-market.ts`, `lib/ebay-browse.ts` — the tier fetching and title
  filtering.
- `card-refs.ts` — the 12 hand-resolved cards. Phase 6 generalises this; it does
  not replace it. The existing refs keep working throughout.

The one thing that *should* change, and is worth doing before any of the above:
**`buildCached` caches upstream failures as if they were results.** An exhausted
budget window currently freezes empty markets into a card's page for up to a
day — observed twice in one session. It costs no quota to fix and it protects
everything else.

---

## Related

- `docs/scan-to-collection.md` — the original finding, and the four places
  today's shape assumes a human
- `docs/ebay-market-pipeline.md` — the query model this plan must not disturb
- `docs/pipeline-by-franchise.md` — what each source does and does not carry
- `GCP-CONTEXT.md` — quota and cost constraints for any hosted component
