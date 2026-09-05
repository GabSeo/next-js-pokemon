# Adding a card — and what to do when the APIs can't find it

Adding a card to this site is adding one entry to `src/data/card-refs.ts`.
Everything else — identity, prices, history, graded listings, the three
locale views — is resolved live from that entry.

Most cards need nothing but the entry. This document is about the ones that
don't, and about the order to try things in, so a card that resists doesn't
turn into a pile of per-card special cases.

The rule the whole process is built around:

> **Pointers may be stored by hand. Content may not.**

A hand-confirmed id or URL says *where to look*. It goes stale loudly — the
row moves, the audit says so. A hand-typed name or price says *what is true*,
and goes stale silently, on a page whose entire proposition is that its
figures were read from a source today. So there are exactly two escape
hatches, both pointers, and no third.

---

## 1. Write the ref

The minimum is franchise, tcg, slug, displayName, character and `lookup`.
For One Piece add `berryWalletEnabled: true`. Copy the nearest existing entry
and read the field comments in `card-refs.ts` — they carry the reasoning that
is not repeated here.

`lookup` is the one field worth getting right first, because every gap below
is downstream of it:

- `by: "code"` — One Piece, and anything with a stable card code.
- `by: "nameSet"` — Pokémon, where the name + set + number identify it.
- `variantTags` disambiguates when one code covers several products. It has
  to match words the **upstream catalogue's** own `name` contains, not what
  a seller would write. (eBay's vocabulary is a separate field —
  `ebayVariantTags` — for exactly that reason. See
  `docs/ebay-market-pipeline.md`.)

- `excludeTags` rejects a candidate whose name contains any of them, even when
  it satisfies every `variantTags`. Reach for it the moment one product's name
  is a **prefix** of another's, because then no positive tag can separate them
  and the winner is catalogue order. `OP05-119` has two such pairs —
  `(Alternate Art)` inside `(Alternate Art) (Manga)`, and `(SP)` inside
  `(SP) (Gold)` — and the plain tag measurably returned the EUR 8,000 Manga
  instead of the EUR 283 card. It applies to BerryWallet and apitcg, **not** to
  eBay, whose query is built from the positive tags only.

For One Piece, *why* one code covers several products is worth understanding
before you write the tags — see **How a One Piece card number is built** at
the end of this document.

## 2. Audit it

```bash
npx tsx scripts/card-audit.mts <slug>
```

It resolves the card through the same functions the product page calls and
prints what each source returned, then a GAPS section naming the escape hatch
for each thing that is missing. `--all` sweeps every ref; it is the expensive
form, for before a deploy.

Read the GAPS section before touching anything. A gap is not automatically a
problem — "no Japanese Cardmarket product" is frequently the correct answer,
because Cardmarket genuinely lists none.

## 3. Close the gaps, in this order

**a. Fix the derivation.** Always try this first, and prefer it even when it
is more work. A rule fixes every card at once; a pin fixes one and hides the
rule's absence from the next person.

Worked example: Shanks OP09-004 and Marshall D. Teach OP09-093 had their
Japanese Cardmarket product rejected because `isJapaneseProduct` only accepted
a `-Japanese` set suffix. Cardmarket spells it `-Non-English` on the newer
sets. One predicate changed, both cards fixed, and every future OP09-era card
with it. A pin on each card would have "worked" and taught nothing.

Worked example: Monkey D. Luffy ST21-014 resolved to **nothing at all** — the
bounded walk gave up after six sets in both languages. The set guess was
`cardNumber.split("-")[0]`, so `ST21-014` asked for `ST21`; BerryWallet's real
code is `ST-21`. One character. Storing `berryWalletSetCode: { en: "ST-21" }`
fixed the card in thirty seconds and was the wrong fix: the same miss applies to
every starter deck and every extra booster, because the catalogue writes
`OP05` unhyphenated but `ST-21`, `EB-01`, `PRB-01`, `LT-01` hyphenated, while
their card numbers are uniformly `ST21-014`, `EB01-001`. `prefixCandidates`
(lib/berrywallet.ts) now offers both shapes; the pin was deleted before it was
ever committed. The extra candidate costs no requests — candidates are only
matched against set codes the catalogue already returned, so one that names no
real set reorders the walk and nothing else.

Worked example: Monkey D. Luffy P-033 had no Western Cardmarket block. The
first fix was a stored id on that one ref. The general rule underneath it —
rows sharing a TCGplayer product are the same physical card
(`findCardmarketSiblings`) — resolves it and its siblings without storing
anything. The stored id was deleted.

**b. Pin the source row** — `berryWalletCardmarketId: { en?, jp? }`.

For when the row exists upstream but nothing links it to this card: no shared
TCGplayer product, no matching `card_number`, no set relationship. Real
figures still flow, because a real row is still being read; the pin only says
which one. It takes precedence over the derivation, because a human confirmed
it against the live catalogue.

Pokémon's equivalents already exist and are older than this document:
`pokeWalletCardId` (Japanese print) and `pokeWalletWesternCardId` (Western
print). Same idea, same standard of proof.

**c. Pin the link** — `cardmarketProductUrl: { western?, japanese? }`.

For a print whose real product nothing here reaches correctly. A link and
nothing else: no figures are read from it and none are typed beside it. The
panel renders the real link above "Cardmarket lists this print, but no price
feed we use covers it."

Two cases, both confirmed by hand on cardmarket.com — the only place they can
be, since Cardmarket answers automated requests with a CDN bot challenge:

- **No row exists.** `monkey-d-luffy-p-106` was the worked case. The ref was
  removed on 2026-09-04, so this is a finding rather than something the audit
  will reproduce — the measurement stands and the shape recurs. Cardmarket
  sells that printing under `Winner-Cards`, and BerryWallet has no row on it.
  Measured 2026-09-02 by sweeping every `CM-*` set row by row — its entire
  Cardmarket coverage is eleven sets:

  ```
  Unnumbered-Promos            Promos              Reprints
  Unnumbered-Promos-Japanese   Promos-Japanese     Premium-Bandai-Products
  One-Piece-Products           Judge-Promos        Special-Tournaments-Promos
  Mini-Promo-Cards             Special-Tournament-Promos-Japanese
  ```

  `Winner-Cards` is not among them, no BerryWallet set matches `/winner/i`,
  and no row in the flat index points at it. Nothing to join on, so (b) cannot
  help either. Note the four P-106 rows BerryWallet *does* hold are the OTHER
  printings of that code — pricing one of them here would be the merge this
  codebase refuses to make.
- **The row is wrong.** BerryWallet's Japanese rows for the One Piece promo
  sets carry URLs that break on arrival:
  `Unnumbered-Promos-Japanese/MonkeyDLuffy-OP09-061` redirects to root, and
  `Promos-Japanese/MonkeyDLuffy-P-033-V1` opens a product listing Chinese
  copies — the real Japanese product is `-V2`.

It **corrects the link and keeps the figures**. In the second case the row is
not the wrong card — it is the right card's prices behind a URL that has gone
bad, which is what the euros on both promo rows turned out to be when they were
checked against the real product pages. So a pin replaces the URL and nothing
else, and both cards' JP tabs still show live BerryWallet figures.

That makes a pin an assertion, so the comment beside it has to say the prices
were checked against the pinned product. Nothing in the code can check it. In
the first case, where no row exists at all, there are no figures to keep and
the panel says so.

**Verify a URL before pinning it.** A Cardmarket URL can fail three ways and
only one of them looks like failure: a 404, a redirect to root, or a product
page that loads and is the wrong variant. The last is the dangerous one — check
that the listings on the page are the language and printing you expect.

**d. Accept the gap.** Leave it, and write one comment on the ref saying what
you checked and what you found. An inert locale toggle and a stated absence
are both real UI states this site renders on purpose.

There is deliberately no override for identity text. `monkey-d-luffy-op09-061`
and `monkey-d-luffy-p-033` have no Japanese identity row in BerryWallet — the
rows carrying their Japanese Cardmarket products hold English names and a null
`card_number`, so nothing can match them — and their Japanese name and art
stay English rather than being hand-typed.

**Identity and market data are separate facts, and the code treats them that
way.** Both of those cards do have a real Japanese Cardmarket product
(`Unnumbered-Promos-Japanese/MonkeyDLuffy-OP09-061`,
`Promos-Japanese/MonkeyDLuffy-P-033-V1`), reached by the ordinary derivation,
and their JP tab shows those real euros — €375.59 against the Western €485.65
for OP09-061 — under an English name. A missing translation is not a reason to
withhold a price that exists.

The inverse is enforced just as hard: the JP tab never shows the WESTERN
listing's figures. It did until this was seen in preview, on the reasoning
that a real listing beats an empty panel and the panel labels the print
honestly. It does not hold — the section heading says "JP MARKET", and euros
under that heading tell the reader something false whatever the small print
says. With no Japanese product, the panel states the absence and points at the
tabs where the Western listing lives.

## 4. Verify

Re-run the audit. Then load the page and switch the market toggle through
every state the card supports — a block that resolves is not the same as a
block that renders.

**A failed lookup is cached like any other answer.** `getCardBySlug` is wrapped
in `buildCached` (lib/build-cache.ts), which writes to
`.next/cache/resolved-cards/v<N>/card%3A<slug>.json`. If a source was rate-
limited the first time a card resolved, the *degraded* card is what gets
stored — and it survives fixing the credential, because nothing re-reads the
source. Confirmed on ST21-014 on 2026-09-04: apitcg 429'd during the first
audit, the card cached with zero history points, and two further audits with a
working key still reported zero. Deleting that one file returned 100 points on
the next run.

So when a gap does not close after you have fixed its cause, delete the card's
cache entry before believing the gap:

```bash
rm ".next/cache/resolved-cards/v8/card%3A<slug>.json"
```

---

## Known upstream gaps — check here before investigating

Measured 2026-09-05 while adding `monkey-d-luffy-st21-014`. Each of these cost
real quota to find. None is a bug in this codebase, and none should be
re-derived.

### BerryWallet's `getSets("en")` is not the whole Western catalogue

Four Cardmarket-backed sets are returned **only** by `getSets("jp")`, despite
carrying no `(Japanese)` suffix and holding Western products:

```
CM-SPECIAL-PROMOS   Special Tournaments Promos
CM-PREMIUM-BANDAI   Premium Bandai Products
CM-PRODUCTS         One Piece Products
CM-REPRINTS         Reprints
```

`getSets("en")` returns only four `CM-*` sets at all — `CM-UNNUMBERED`,
`CM-PROMO`, `CM-JUDGE`, `CM-MINI-PROMO`. Since `findCardInLanguage(code, "en")`
walks the English list, **the four above are unreachable from any English
resolution**, including `Premium-Bandai-Products` — the exact family OP09-061's
`cardmarketProductUrl` pin was written for. Worth remembering before concluding
that a Western Cardmarket product is absent: it may just be on the other list.

### Whole sets carry `card_number: null`

All 300 rows of `CM-UNNUMBERED-JP` have a null `card_number`; the code lives
only inside `name`, as `Monkey.D.Luffy (ST21-014) (V.1)`. `CM-SPECIAL-PROMOS`
also carries a `card_number` of `61.0` — a float — where `EB04-061` belongs.

`findCardInLanguage` already survives this, because it matches
`c.card_number === cardNumber || c.name.includes(cardNumber)`. Anything new
that keys on `card_number` alone will silently miss these rows. Treat
`card_number` as a hint, never as a key.

### Upstream coverage is partial, and asking is cheaper than working around it

BerryWallet tracks the `Special-Tournaments-Promos` Cardmarket set as
`CM-SPECIAL-PROMOS` — 21 rows, all 21 pointing at that slug — but holds only 20
`DON!!` prints plus one Luffy (`EB04-061`). It has no row for
`MonkeyDLuffy-ST21-014-V1`, and skips `DON!! (V.12)`.

So the missing thing is a **row inside a set they already track**, not the set.
A backfill was requested from the upstream devs on 2026-09-05. If it lands,
`monkey-d-luffy-st21-014` gains its Western Cardmarket block through ordinary
derivation and needs no pin at all — which is why no pin was added meanwhile.

**Phrase an upstream request in their terms.** Name the set code they already
have, say how many rows it holds, and name the exact product slug that is
missing. "Add this set" invites the answer "we have it".

---

## How a One Piece card number is built

Source: a collector-guide carousel (`win the card`, Instagram), supplied
2026-09-04. **Third-party, not measured here** — orientation, not the same
standard of proof as the hand-confirmed findings above. Where this codebase's
own data speaks to a claim, it is said so.

Everything printed in the bottom-right corner of a card, in order:

```
OP05-119  SEC  ★  (2)
  │   │    │   │   └── block icon — tournament regulation only
  │   │    │   └────── alternate version (incl. Manga alt art)
  │   │    └────────── rarity code: C · UC · R · SR · SEC · L
  │   └─────────────── identifier within that set
  └─────────────────── prefix + set number
```

- **Prefix — the family.** `OP` booster pack, `ST` starter deck, `EB` extra
  booster, `P` promo. It records where the identity *began*, not every product
  it later appears in.
- **Set number — the era.** OP01 Romance Dawn (2022), OP05 Awakening of the New
  Era (2023), OP09 Emperors in the New World (2024), OP13 Carrying on His Will
  (2025).
- **Block icon — ignore it.** The digit in the Devil Fruit near the number is
  Bandai's Standard-format regulation block (1 = OP01–04, 2 = OP05–08,
  3 = OP09–12, 4 = OP13–16). It is play eligibility, never part of the code.

### The four points that change how you write a ref

**1. The code is an identity, not a printing.** `OP05-119` says *which card*,
not which copy. It does not carry the printing, the artwork, whether it is a
special version, or which product it came from. Two cards can share the number,
look nothing alike and be worth wildly different amounts. This is the whole
reason `lookup.by: "code"` under-determines a One Piece card and `variantTags`
exists next to it.

**2. Each prefix family runs its own sequence.** `OP01-001`, `ST01-001` and
`EB01-001` all exist at once and are three different cards. **A bare number is
never a key** — which is exactly how the P-106 join failed here: TCGplayer's
rows said `P-106`, Cardmarket's said `106`, and nothing could tell whether that
was the same card or a coincidence.

**3. Product code ≠ card number — the PRB trap.** A card reprinted inside
PRB-01 (Premium Booster) does *not* become `PRB01-xxx`; it keeps `OP05-119`.
PRB-01 is the product, `OP05-119` is the card. Upstream catalogues organise by
product, and our `lookup` keys on the card, so expect a set name that reports a
product the card was *reprinted into* rather than where its identity began.
That gap is what makes guessing `berryWalletSetCode` expensive — see Budget.

**4. One promo number, several official versions.** Promo numbering is just
`P-` plus an identifier, and Bandai reuses it: `P-001` shipped as both a Super
Pre-Release participation card and a Winner Card Silver Foil Version.
**Corroborated by our own data** — BerryWallet holds four separate `P-106` rows
(Promos/-V1 and Promos-Japanese/-V1/-V2/-V3), each a different printing of one
code. For a `P-` card, `variantTags` is load-bearing rather than a refinement,
and picking the wrong row prices a different physical object.

### And one that changes what you should expect to find

**SP, Manga and Parallel treatments are versions, not cards.** The artwork,
foil and texture change; the number and the printed rarity do not. `OP05-119 |
SEC` and `OP05-119 | ★ SEC` are the same identity in two collector versions. So
no distinct code will ever separate them — the separation has to come from
`variantTags` matching the catalogue's own product name, or it does not happen
at all.

---

## Budget

Four metered APIs sit behind a card, two of them at 100 calls/hour
(BerryWallet, PokéWallet). Adding a card is the most call-hungry thing anyone
does here, and an exhausted quota looks exactly like a missing card.

- `card-audit.mts` costs roughly a dozen calls per card. `--all` multiplies
  that by every ref.
- It does **not** touch eBay. A graded-market pass is 6–8 searches per card
  against the tightest budget in the app and answers none of these questions.
  Use `scripts/ebay-query-lab.mts` when the question is actually about eBay.
- Before concluding "this card doesn't exist upstream", check
  `scripts/api-budget-report.mjs` and re-run once. A 429 and a genuine absence
  are indistinguishable from inside a single failed lookup — this has already
  cost one session an afternoon.
- A missing `berryWalletSetCode` turns a One Piece lookup into a bounded walk
  across sets. One promo card once consumed a full hourly ceiling that way.
  Fill the code in once it is confirmed from a real resolution.
