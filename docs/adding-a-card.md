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

- **No row exists.** Cardmarket sells Monkey D. Luffy OP09-061 under
  `Premium-Bandai-Products-Asia-Region-Legal`; BerryWallet's `CM-PREMIUM-BANDAI`
  maps only to `Premium-Bandai-Products`, and the only `-Asia-Region-Legal`
  sets it carries are Starter-Deck-Egghead, Heroines-Edition and
  Egghead-Crisis. Nothing to join on, so (b) cannot help either.
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
