# Scan → page → collection

**Status: an architecture note, not a plan of record.** Everything under
"Measured" was observed against the live APIs on 2026-09-04 while adding
`monkey-d-luffy-st21-014`. Everything under "Implication" is reasoning from it
and has not been built or agreed.

The goal it is written against: *a person photographs a card, the card gets a
page, and the card appears in their collection.* That is three different
problems wearing one sentence, and adding ST21-014 by hand exposed where each
one actually breaks.

---

## 1. What exists today

- **`src/data/card-refs.ts`** — nine hand-written entries. Everything the site
  shows is resolved live from one of them.
- **`AddToCollectionButton`** writes `localStorage["cardtrace:collection"]`, an
  array of **slugs**.
- **`/collection`** is a placeholder that does not read that array yet.

So a collection today can only ever contain cards someone hand-added to
`card-refs.ts`. The button is real; the corpus behind it is nine cards wide.

---

## 2. The finding that shapes everything else

### Measured

`searchCards("ST21-014")` returns four real rows. All four are rarity **SR**,
all four are Monkey D. Luffy, all four are Red / cost 5 / power 6000 / Strike:

| BerryWallet name | TCGplayer market |
| --- | --- |
| `ST21-014 (3rd Anniversary Treasure Campaign Pack)` | **USD 1,747.19** |
| `(014) (Parallel)` | USD 29.51 |
| `(014)` | USD 8.67 |
| `ST21-014 (Luffy Deck)` | USD 8.58 |

**A 204× spread, and every field a scanner could read off the card is identical
across all four.** The code is the same. The rarity is the same. The stats are
the same. The only thing separating a USD 1,747 card from a USD 8 deck common,
anywhere in the data, is a product-name substring.

This is not an edge case. It is the documented rule — see
`docs/adding-a-card.md`, *How a One Piece card number is built*: a reprint keeps
its original number, and SP/Manga/Parallel treatments are versions of an
existing card, not new cards.

### Implication

**A card code identifies a card. It does not identify a collectible.** Any
pipeline whose primary key is the code will happily put a four-figure card and
an eight-dollar one in the same bucket — including a user's collection total.

The unit the platform needs is a **print identity**: roughly
`(tcg, code, printing)`, where `printing` is what `lookup.variantTags` encodes
today by hand.

---

## 3. Where today's shape assumes a human

Four places. Each one is a person doing something a scanner cannot.

### a. The printing is chosen by a hand-written string

`lookup: { by: "code", code: "ST21-014", variantTags: ["3rd Anniversary Treasure"] }`

A human read four row names and picked a substring that appears in exactly one.
Matching is `name.toLowerCase().includes(tag)`, every tag required
(`pickVariantByTag`). Nothing derives the tag; nothing validates that it still
selects one row rather than three.

### b. The fallbacks are silent, and they are wrong

Both resolvers guess rather than refuse when the tags miss:

- `findProductByCode` (apitcg) → `candidates[0] ?? data[0]`
- `findCardInLanguage` (BerryWallet) → `highestVariant(matches)`

**Measured:** `findProductByCode("one-piece", "ST21-014")` with no tags returns
`Monkey.D.Luffy (014)` — the USD 8.67 common. With the tags it returns the
Campaign Pack. A ref that lost or mistyped its tags would not error; it would
render a complete, confident, wrong page.

### c. The catalogues disagree about which set a card is in

**Measured**, for the same physical card:

- BerryWallet → `Starter Deck EX: Gear 5 (ST-21)` — the set of **origin**
- apitcg → `One Piece Promotion Cards` — the **product it was distributed in**

Neither is wrong. `ST21-014` began life in ST-21 and was later handed out in a
campaign pack, exactly the PRB pattern. But it means **set is not a stable join
key across sources**, and any auto-matching that assumes it is will mismatch on
precisely the promo-shaped, high-value cards worth matching.

### d. Cardmarket cannot be verified by a machine at all

Cardmarket answers automated requests with a CDN bot challenge, so
`cardmarketProductUrl` is by construction a human assertion. ST21-014 has no
Western Cardmarket block: the only ST21-014 row carrying one belongs to the
**Luffy Deck** print at €4.87, and using it would price a different object.
That gap stays open until a person opens cardmarket.com.

---

## 4. The thing a scan has that a code lookup does not

A photograph.

The four ST21-014 printings are indistinguishable in their *data* and obviously
distinguishable to the *eye* — different artwork, different foil, different
texture. The discriminator the code cannot carry is sitting in the image the
user just captured.

So the scan path is not a worse version of the code path. It is the only path
with access to the missing signal, and the resolution order inverts:

```
today   code ──────────────► one row  (a human pre-chose the tag)

scanned code ──► N rows ──► rank by image ──► confirm with the user ──► print identity
```

**Implication.** Present the candidate rows *with their images and their
prices* and let the person confirm. A 204× spread is not a detail to resolve
silently on the user's behalf, and "which of these four is the one in your
hand?" is a question a collector can answer instantly and a heuristic cannot.
The confirmation is also the training signal that would let ranking improve.

---

## 5. What has to change before this runs at scale

Ordered by how badly it breaks.

1. **Refuse instead of guessing.** §3b's two fallbacks must become an explicit
   *unresolved* state that the UI can render. Auto-generated cards multiply a
   silent wrong answer by the number of scans.
2. **Make the printing a resolved value, not a typed string.** `variantTags` is
   an input to matching; a print identity is the *output* and is what a
   collection row should store. They should not be the same field.
3. **Do not cache degraded answers.** `buildCached` stored ST21-014 with zero
   history because apitcg happened to be rate-limited during the first
   resolution, and it survived a working key across two further runs (see
   `docs/adding-a-card.md` §4). At scan scale that is a user whose card is
   permanently wrong because of a transient 429. Cache entries need to record
   which sources actually answered, and a partial answer needs to expire.
4. **Fix heuristics as rules, never as pins.** ST21-014's set guess missed by
   one character (`ST21` vs `ST-21`), which a stored code would have papered
   over for one card while every future ST and EB card failed identically. It
   became `prefixCandidates` instead. A scanner has nobody to write the pin.
5. **Give collection rows provenance.** What was scanned, when, which candidate
   the user confirmed, and how sure the match was. A collection total is a
   claim about money; it needs to be auditable back to a decision.

---

## 6. Open questions

- **Slugs.** Today they are hand-written and human-readable
  (`monkey-d-luffy-st21-014`). A scanned corpus needs them generated, and this
  one already collides with three sibling printings that would all want it.
- **Do users own refs, or reference them?** A collection of print identities
  pointing at shared refs is cheap; a ref per scanned card is not, given every
  ref costs live API calls on every build.
- **What happens to a card no source carries?** Today the answer is "it is not
  a ref". For a scanner it has to be a rendered state.
- **Grading.** A scan sees a slab label too. That is a fifth axis on top of
  print identity, and the Grading Center already assumes it.

---

## Related

- `docs/adding-a-card.md` — the manual workflow this generalises, including how
  One Piece card numbers are built.
- `src/lib/berrywallet.ts` — `prefixCandidates`, `pickVariantByTag`,
  `findVariantAcrossProducts`, `findCardInLanguage`.
- `src/lib/build-cache.ts` — the caching described in §5.3.
