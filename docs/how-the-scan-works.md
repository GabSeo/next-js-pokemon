# How a photo scan works — and how to scale with it

The companion to `docs/pokemon-catalogue-pipeline.md`. That one explains where the
references come from; this one explains what happens to a photograph, why each
threshold is the number it is, and what breaks first when this grows.

**This document is about the PHOTO scan only.** The live camera view was parked
in September 2026; everything specific to it — the per-frame loop, the card
detector, the three viewfinder states — now lives in `docs/live-scan-parked.md`,
unchanged, because it is a record of measurements that were real.

Three pieces of it stayed here, and the reason is worth stating: they were filed
under the camera and the photograph depends on them. §6's thresholds are imported
by `scan-client.tsx`. §7's resampling test is what says a browser's `drawImage`
may query an index built with sharp. §10's "twenty real cards, one match" was
measured on photographs taken with a phone.

Every figure is measured, and the script that measured it is named. Measured
2026-09-09; the evidence rules added 2026-09-13; restructured around the photo
scan 2026-09-13, when §1, §2 and §9 were each found to describe the opposite of
what the code does.

---

## 1. The whole thing, in one paragraph

You photograph a card. **The image is uploaded and read by Google Cloud Vision
first, every time**, because the number printed in the corner is evidence and the
artwork is only a guess. The catalogue turns that number into candidates — rarely
one, as §5 shows — and a model already in your browser scores each candidate
against the photograph to put them in order. The card at the top is the answer.
The artwork answers *alone* only when Vision comes back with nothing.

The Vision call is **metered at 33/day** and is the only metered thing anywhere
near the scan. Everything after it is free and local.

---

## 2. The pipeline

```
photo upload
    ↓
POST /api/scan/ocr          the image leaves the device here   (~2.1 s)
    ↓
Google Cloud Vision  →  raw text
    ↓
lib/card-code-ocr.ts  →  the printed number, repaired          (§4, rules 7-13)
    ↓
lib/card-lookup.ts    →  every card that number could name
    ↓
        ┌───────────────┴───────────────┐
   2 or more candidates            0 candidates
        ↓                               ↓
   MobileCLIP-S2 fp16, in the      the artwork answers alone:
   browser, scored against ONLY    a search through 54,637
   those candidates                vectors, floor + margin
        ↓                               ↓
   an ORDER — it cannot miss       a verdict — it can decline
        ↓                               ↓
        └───────────────┬───────────────┘
                        ↓
                  the card, and every printing of it
```

The two branches are not the same operation, and conflating them is how a scan
goes confidently wrong. The left is a **comparison** between four things, and it
cannot fail to contain the right answer because the number already proposed it.
The right is a **search** through everything, and it can — measured, a correct
card has sat at rank #184.

---

## 3. The rule: printed text is evidence, the artwork is a guess

**This is the most important rule in the scan, and it was broken for weeks
without anyone noticing.**

### How it broke

The photo path worked. Then the live view was built, and its reasoning — the
artwork is all we have, a tie is an answer, escalating to a metered reader is
impossible at 30 fps — was correct *there* and got applied to the photo path,
where every premise of it is false. The photo path stopped calling the reader
except as a last resort, and nobody noticed because it still returned cards.

The failure that exposed it: the same photograph of a slabbed Eustass Kid
resolved correctly with the Japanese catalogue selected and wrongly with the
English one. The banner carried the reason — `margin 0.016`, against a
`CLIP_CONFIDENT_MARGIN` of 0.015. A wrong card cleared the bar by a thousandth,
so the scan called itself certain and never asked the reader. With the other
catalogue the same photograph failed the margin, fell through, and came back
right.

### Why no threshold fixes it

Checked, not assumed. Across four real photographs:

| | score | correct? |
|---|---|---|
| Moltres, centre crop | 0.94 | yes |
| Moltres, whole frame | 0.82 | yes |
| Pikachu GG30 | 0.83 | **no** |
| Eustass Kid, slab | 0.77 | **no** |

The distributions overlap. There is no number that separates them.

An agreement rule was tried next — do the three crops of one photograph name the
same card? Measured on the failing slab: **two of three agreed on the wrong
card.** Necessary, not sufficient, discarded.

### The principle

**The artwork is a guess; the printed number is evidence.** A picture is shared
between reprints, between a card and its Japanese release, and — where 4,839 of
5,809 One Piece vectors were built from pictures Bandai stamps "SAMPLE" across —
between a real card and a watermarked reference that merely resembles it. The
number in the corner names one card, and Vision read `OP05-074` off a PSA slab
through the plastic.

Both run in parallel on a photo, so the rule costs no time.

---

## 4. What counts as evidence — the rules learned by breaking them

§3 says the printed code leads. This section is the rest of that argument: once
a code has named several cards, or one card several printings, **something has to
choose between them**, and every rule below was written after a wrong choice
reached a screen.

They are listed as rules because that is how they have to be re-read. Each one is
a line in `lib/scan-order.ts`, `lib/card-code-ocr.ts` or `api/scan/ocr/route.ts`
that looks arbitrary and is not.

### The rules

**1. Presence is evidence; absence is not.**
`JAPANESE_SCRIPT.test(text) ? "ja" : "en"` read *no kana was found* as *this is an
English card*. It means no kana was **read** — and on a Japanese Aerodactyl V,
Vision returned `ta | *755V | DA | MP | 210` with not one kana in it. The number
came back perfectly and was looked up in a catalogue that cannot contain it. Now:
kana → Japanese, no kana → search everything. Measured across the twelve numbers
in `img test/`: four are findable only this way, eight English ones widen by
between nothing and five candidates.

**2. Evidence that does not discriminate is not evidence.**
A photographed Wanted Poster `OP05-119` reads `SEC`. Seven of its twelve
printings are SecretRare and the Wanted Poster is `Special`, so a one-point bonus
meant to discriminate rewarded the majority and pushed the card in hand from
second place to seventh. The bonus now requires a strict minority.

**3. A picture cannot see what language a card is in.**
A Japanese printing and its Western release are the same artwork. The signature
put `JP · OP-09` at 0.309 ahead of the English OP-09 at 0.383 on a card whose
every sentence was read in English. Rules text is evidence the picture does not
carry, and both directions are positive — kana says Japanese, a page of Latin
words says Western. Measured: 34 to 44 Latin words on four Western photographs,
**0** on the Japanese one whose OCR failed.

**4. "I cannot compare this" is not "this is the worst of these."**
The client sorted unscoreable candidates with `?? Number.MAX_SAFE_INTEGER`. A
CGC-slabbed Lugia `090/087` names `ja~E3-090` and `ja~CP6-090` Charizard ex; the
slab label says "Lugia" so the server ranked the Lugia first, but E3 is pictured
nowhere, so the client sent it to the back and the page announced Charizard ex.
Only scoreable candidates are reordered now, into the slots they already occupy.

**5. A card does not print its name as one string.**
The catalogue says "Charizard VMAX"; the card prints `VMAX Charizard VY Evolves
from Charizard V`, because the badge sits above the name. `text.includes` was
false, the name signal was lost entirely, and Tropius led on a photograph of an
orange dragon — 0.779 against 0.812, all three candidates above 0.77, which is a
guess rather than a choice. Matched word by word now, in whole words.

**6. The script band goes first; the name goes last.**
Both live in `orderCandidates` and they are not the same kind of claim. Running
the whole function after the picture let the script band — which contains no name
evidence — overrule a verdict the picture had earned: an N's Reshiram `SV9
109/100` became a Wooper, purely because the Wooper is English. The order is
script (a tie-break) → picture → name (evidence, alone).

**7. `\b` cannot see inside a glued run.**
OCR welds neighbouring glyphs. `560003/069` hid a real `003/069`; `FSWSH286` hid
`SWSH286`, the set symbol having come back as a letter. Both patterns therefore
refuse a leading word boundary and let the catalogue validate instead — measured,
every adversarial token a real card prints (`HP90`, `HP310`, `LV23`, `V717`,
`PV60`, `GEM10`) resolves to no card.

**8. A Pokémon number is a fraction — except for 658 cards.**
42,791 cards print `074/073`. 1,536 print a prefixed code. **658 print a bare
number, because their set has no official total**, and those are the promos. A
bare number is not a card number anywhere else.

**9. The same `#` means two things on one card.**
On a slab label `#9` is the card number. On the card face `#151` is the Pokédex
number — a Wizards Mew prints `#151`, a Birthday Pikachu `#25`. The tell is the
layout: `LV. <n> #<pokédex>` are written together, so a `#` following a level is
never a card number.

**10. A grading label states the grade, not the grader.**
`\bPSA\b` is **false** on both real PSA slabs measured: the company sets its name
as a logo, so there is no text to read. `GEM MT` is read on both. A grade phrase
also describes the slab rather than the card, which is why none of the four
occurs in any of the 44,985 card names.

**11. A grader's name can collide with the game's own vocabulary.**
TAG Grading and ACE Grading are deliberately absent from that list. Pokémon
prints **TAG TEAM** and **ACE SPEC** on real cards, and Vision does read `TAG`
out of `megasableye-tyranitargx-226-236.jpg`. Listing it reported a grading label
on a raw card and defeated the only gate the finish reader has.

**12. `SP` in a One Piece corner is the rarity.**
Bandai prints SEC, SP, SR, L, UC and R down there, and `rarityFromText` owns that
vocabulary. Reading the same letters as a *treatment* boosted the OP-11 SP
printing, a different card with different artwork. Inside a parenthetical, `(SP)`
stays safe — a rarity corner is not written in brackets.

**13. A set code in front of a fraction is labelling that fraction.**
`SV9 109/100` is not a card called `SV9`. Without that guard it resolved to
`sma-SV9`, a Wooper.

**14. A filter the reader set must reach the server.**
Both lookups passed `undefined` for the game, so a Pokémon scan searched both
catalogues. Harmless for a code — a Pokémon number cannot name a One Piece card —
but the name fallback searches by NAME, and a name carries no game in it. A
photographed Pikachu came back with `OP-09 Thunder Lance` among the Pikachus,
because Vision had read the word "Lance".

**15. A cap on work skips the cards that need the work most.**
`MAX_RANKED_PRINTINGS = 10` excluded 30 codes from printing-order ranking — the
chase cards, the ones photographed *because* they have sixteen versions at wildly
different prices. Written when each reference was fetched and hashed per scan; by
the time it was found, signatures were precomputed and one comparison cost
**0.24 µs**.

**16. A picture on a page is not a picture the scan can use.**
An image reaches a card page through `pokemonImageUrl`, and it reaches the
scan through a vector and a signature computed ahead of time. Those are two
different paths, and 2,308 Japanese images travelled only the first: the
generators knew three sources and all three answer with a URL, so a file held
in this repository fell through to `unpictured` and was embedded not at all.
The cards rendered perfectly and were invisible to every comparison. The tell
is exact and worth knowing — a reference image that does not match ITSELF has
no vector, which is how it was found. One Piece never had the bug: its two
generators read `public/card-images/one-piece` from the first line, 970 of 970.

### The shape underneath all of them

Three sentences the whole scan obeys. Every rule above is one of them applied
somewhere specific, so a new rule that contradicts one of these is almost
certainly wrong.

1. **The artwork is a guess; printed text is evidence.** §3 says this about the
   code. It holds one level down too — between printings, between candidates,
   between languages.
2. **Evidence that does not discriminate is not evidence.** A rarity seven of
   twelve printings share, a word printed on every card of an era, a fact every
   candidate satisfies: none of them chooses, so none may outrank something that
   does.
3. **Absence is not evidence of absence.** No kana read, no signature on file, no
   picture published — each means *we cannot tell*, never *it is not this one*.

### What is still unfixed

**A raw promo's bare number.** A Birthday Pikachu prints `24` in the corner with
no marker. Nothing on an unslabbed card names its set, so that `24` is
indistinguishable from the 50, the 30 and the 17 around it. Reaching it means
emitting every bare number scoped to a set — around eight candidates for one
right answer.

**386 cards with no reference at all** — down from 3,465, and the remainder is
now understood rather than merely counted. 201 are in `VS1` and `neo2`, printed
2000–2001, before the publisher's own card search reaches. 79 are secret rares
numbered past the total printed on the card, which every free source stops at:
Limitless lists exactly 173 cards for `SM12a`, and the blind ones are 211 to 226.
98 are in the `#DPBP` sets, which carry no release date, which Limitless does not
know at all, and which may well be phantoms like the fifteen `CS` sets deleted in
567ce73 — unverified either way. 8 are basic energies.

The 3,079 that were fixed came from tcgcollector.com in September 2026, and that
door is now closed: their origin began returning 502 during the run, and the
scraper was deleted rather than slowed (42751f7). The honest route to the last
386 is TCGdex itself, which is open source and takes contributions.

**The client's own CLIP re-rank** is now described — §5 says why it exists, §6
what it leans on. It remains the last word on screen, and the step most likely to
be wrong without anyone noticing, because its output is an ORDER rather than a
claim: nothing about it fails loudly.

---

## 5. Why a number is not an identity

**A Pokémon card does not print its set.** It prints `093/108` — a number and a
set SIZE, which is not the same fact. The symbol that names the set is a picture,
and no reader names it.

So Vision reading the number perfectly still leaves the question open, and not
rarely. Measured across the whole catalogue:

| | cards with a readable printed number | share their `number/total` with another card |
|---|---|---|
| English | 19,372 | **11,408 — 58.9%** |
| Japanese | 23,419 | **15,610 — 66.7%** |

Worst case in each: `1/30` names 14 different English cards, `1/21` names 14
Japanese ones. `93/108` is Dark Patch, Ultra Ball, Claydol ex and a Water Energy,
in four different sets, all genuinely numbered 93.

**This is the entire reason the model still runs on a successful scan.** The
reader is unambiguous about the number and blind to the set; the comparison
cannot read a number and is very good at telling four pictures apart. Neither
answers alone, and together they do.

**And it is restricted to the candidates on purpose.** A top-N search over 54,637
vectors need not contain a card the number proposed — measured, a correct card
has sat at rank #184 — so a lookup would often find nothing to sort by. Scored
against the candidates it is a comparison rather than a search, and a comparison
cannot miss.

The scans where the model contributes nothing are worth naming too: roughly four
in ten, where the number resolves to exactly one card, and every One Piece scan
with a clean code, because Bandai prints the set on the card and Pokémon does
not. That is also why One Piece was solved first.

---

## 6. The two thresholds, and why a photograph needs them too

These were measured for the live camera and they are load-bearing here:
`scan-client.tsx` imports `clipVerdict`, `clipTied` and `CLIP_MAX_TIED`, and the
failure that rewrote the entire photo path was a margin of **0.016 against a
threshold of 0.015**. Deleting this section would delete the only written
justification for constants a photograph still depends on.

A cosine search **always** returns a nearest neighbour. Point a phone at a grey
wall and the index names its closest card and hands back a number; nothing in the
arithmetic says "that was a wall".

Measured against the full English index (`scripts/clip-floor-lab.mts`):

| frame | score | margin |
|---|---|---|
| flat grey | 0.3568 | **0.0231** |
| flat dark | 0.3668 | 0.0060 |
| random noise | 0.3642 | 0.0009 |
| a card, heavily blurred | 0.6774 | 0.0286 |
| a card, a fifth of the frame | 0.7586 | 0.0012 |
| **a card, filling the frame** | **0.9985** | **0.0772** |

**A flat grey wall clears the margin test.** Its margin of 0.0231 is above
`CLIP_CONFIDENT_MARGIN` (0.015). Without a second test, a live view would name a
card, confidently, at a wall.

So there are two:

- **`CLIP_CARD_FLOOR = 0.50`** — is anything card-like in frame at all? Sits
  between the noise ceiling (0.367) and a badly blurred real card (0.677),
  deliberately nearer the card side. Being generous here costs a "hold steady",
  not a wrong answer.
- **`CLIP_CONFIDENT_MARGIN = 0.015`** — can it be named? Separates three correct
  answers (0.018, 0.036, 0.072) from two wrong ones (0.006, 0.007).

**The margin threshold is a hypothesis, not a calibration.** n = 5. It is exported
from `lib/clip-search.ts` so it can be fitted properly once there are enough
labelled photographs, and so a caller can see what it is trusting.

**A photograph uses them differently, and that difference is the whole of §5.**
Once Vision has produced candidates the match is restricted to them: every
candidate is scored, nothing has to clear a floor, and the output is an order
rather than a verdict. The thresholds then decide one thing only — whether the
artwork may answer ALONE, which happens when the number came back with nothing.

Which is why a margin of 0.016 was so expensive. It let the artwork call itself
certain on a photograph whose printed code had never been read.

---

## 7. Why the model runs in the browser

The model is **68 MB** of ONNX weights. On Vercel that is re-downloaded on every
cold start of a serverless function, which puts an unpredictable multi-second
penalty in front of a feature whose entire proposition is speed.

In a browser it is fetched once and cached, and the comparison in §5 then costs
one inference on a device that already holds the index.

**It is downloaded even on the scans that never use it**, deliberately. The photo
path starts the match and the reader together and awaits only the reader, so a
scan whose number names a single card never waits on the model. It is not
cancelled either: the bytes land in the browser cache and make the next scan warm
for free. The same bytes move; only the wait is gone.

What ships to the client:

| | size | when |
|---|---|---|
| MobileCLIP-S2 (fp16) | 68 MB | once per browser, cached |
| one index | 2.5 – 10 MB | once per catalogue, `immutable` |

Nothing is loaded until something asks for a match, so a visitor who only reads
the page downloads none of it.

### The one thing that could have made this wrong

The index was built with sharp resizing at 256px with a **cubic** kernel. A
browser has no sharp — it has `canvas.drawImage`, whose scaling is
implementation-defined. So a client-side query is not computed the way the
references were, and nothing about the embedding space promises that is harmless.

Measured before building anything on it (`scripts/clip-resample-lab.mts`):

```
kernel      cubic     mitchell   lanczos3   nearest
result       3/5        3/5        3/5       3/5     — identical
margins    within 0.003 of each other
```

Even `nearest`, which no browser does and which is there to bracket the answer,
keeps every hit. The gap is real and does not matter.

---

## 8. The identity problem, per game

This is the part that surprises people, and it is opposite in the two games.

| | Pokémon | One Piece |
|---|---|---|
| indexed unit | the **card** | the **printing** |
| evidence | 0 of 10,110 multi-variant cards have a distinct image per variant | 945 of 945 multi-printing codes do |
| best possible answer | *which card* | *which exact printing* |

**Pokémon has an unbreakable ceiling.** A reverse holo and its normal twin are the
same picture, so artwork can never tell you which finish you hold. Worse, reprints
share artwork across sets: `SM12a-052` is `SM11-029` unchanged, and searching with
that card's own official scan ranks the *other* one first, by 0.0015.

Sampled 250 cards per language against the full index:

| | cards with a near-twin inside the threshold |
|---|---|
| **Japanese** | **28%** |
| English | 4% |

Japanese sets reprint aggressively — starter decks, promos, compilations — and a
reprint carries the same picture under a new number.

**So a tie is an answer, not a failure.** The scan shows the two or three cards
that share the artwork and says why, pointing the reader at the number in the
bottom corner. Refusing would throw away a correct result for having a companion.

**And on a photo it is only the second-best answer.** That correction overshot
once: treating every tie as finished removed the escalation to Vision entirely,
so a photograph the artwork could not place got a confident-looking list and the
printed number was never read. Both of the real slab photos on file land there —

| photo | 1st | 2nd | margin |
|---|---|---|---|
| `sm115-44` Moltres | 0.8178 ✓ | 0.8107 | 0.0071 |
| `swsh12.5gg-GG30` Pikachu | 0.8255 ✗ | 0.8229 | 0.0026 |

— both under the 0.015 margin, so both were shown as ties, and the second one
was three wrong Pikachus shown with confidence.

The argument for dropping the escalation does not transfer from the live view to
a photo. Vision is a metered per-image call that cannot run thirty times a second
— true, and the reason the camera loop has no reader. A photo is **one** image,
at a moment a person chose, and it can afford the call. So the photo path splits
on the verdict rather than on the tie: `identified` answers on the device, and
anything less reads the printed number, keeping the artwork's tie as the fallback
for when the reader comes back empty.

**One Piece is the more precise of the two.** It separates `ST21-014` from
`ST21-014_p1` — two printings of the same card — which Pokémon can never do.

---

## 9. The catalogue filter, and what searching everything costs

**This was titled "Nothing is asked any more", and the page has asked all
along.** Two controls sit above the capture panel — which game, which language —
under the words "the matcher searches every catalogue on its own; narrow it only
if you already know". What was removed was the REQUIREMENT, not the question:
nobody is held at a gate, and a scan with nothing chosen searches everything.

That stopped being a cosmetic distinction when the filter was finally wired
through to the server. Both lookups had been passing `undefined` for the game, so
the panel's promise that the control narrows the search was true of the
on-device matcher and false of the reader — and the reader's NAME fallback
searches by name, which carries no game in it. A photographed Pikachu filtered to
Pokémon came back with One Piece's `OP-09 Thunder Lance` among the Pikachus,
because Vision had read the word "Lance".

Searching everything remains the default, because the person cannot answer faster
than the machine can.

 All four catalogues are searched at once — 52,328
vectors instead of 20,276, about 12 ms instead of 8, and 28 MB of index instead
of 10 next to a model that is 68 MB on its own.

**What the change costs, measured rather than assumed.** Two tests, and they
disagree — which is the point of running both.

*Clean images.* 1,008 reference vectors, each searched against all four indexes:
**one** came back from a different catalogue, and it was the same One Piece card
in its other language — a correct answer, not a confusion. Zero Pokémon/One Piece
crossings.

*Real photographs.* The two slab photos on file, before and after:

| photo | one catalogue | four catalogues |
|---|---|---|
| `sm115-44` Moltres | correct at **#1** | correct at **#4**, behind three unrelated Japanese GX cards |
| `swsh12.5gg-GG30` Pikachu | 3-way tie | **8**-way tie, margin 0.0004 |

A reference image self-matches at ~1.0 and is untouchable; a photograph through
slab plastic sits at 0.82, where the field is dense. Doubling the pool doubles
the chances of something nosing past it. **The first measurement did not test the
case that matters**, and the second one is the honest number.

The outcome for both photos is unchanged — both were already below the margin and
both escalate to the printed-number reader, which now reads `GG30/GG70`. But the
artwork ranking is genuinely diluted, and that is the price of not asking.

**The ambiguity was never solved — it is now shown.** An English card and its
Japanese twin both come back, as candidates, exactly the way two reprints of one
artwork do. The picture cannot separate them and never could; a toggle only moved
the guess onto the person.

### The forty vectors that were winning everything

Found while measuring the above, and it was a live fault rather than a risk:
**40 of 5,809 One Piece English vectors (0.7%) carried a norm of ~2,255 instead of
127** — a self-score of 316 where the maximum is 1.0. A dot product is only a
cosine when both vectors are unit length; past that, a vector's score scales with
its magnitude and it beats everything in the index whatever the picture shows.

All forty are alternate printings (`OP01-101_p1`, `EB02-010_p2`, …), scattered
rather than contiguous, and the current embedder cannot produce them — it divides
by the norm explicitly. They are stale vectors from an earlier recipe, kept alive
by the ingestion's incremental cache, which skips a printing already embedded.

`clipIndexFrom` now re-normalises on load, so the arithmetic is true whatever the
file holds. Before that repair, 18 of the 1,008 reference vectors went astray, all
to those forty. After it, one. **Re-embedding them is still the real fix** — a
repaired vector is the right length and the wrong embedding; it has stopped being
everyone else's answer, not started being its own.

All four indexes are in **one embedding space**, which is what would let a later
version search all of them and drop both questions. That needs measuring first:
two catalogues in one search is two chances to be confidently wrong.

---

## 10. What real use says, and it is not what the tests said

Twenty real cards, laid flat in slabs, on a phone: **one match**. Against
synthetic frames the same pipeline is near-perfect. That gap is the finding —
the tests were not testing the thing.

What differs in real use and is not in any test here: a phone camera's exposure
and white balance, autofocus hunting, glare on slab plastic, and a crop that may
be framing a plastic case rather than a card. Reasoning about which of those it
is, from here, is guessing.

So the live view now SHOWS what it embedded — the exact crop as a thumbnail,
with the score, the margin and the card it is leaning toward — and the guide is
resizable, because a card inside a slab occupies a different fraction of the
frame than a bare one and no fixed number fits both. The next move is a
screenshot of that panel with a real card in frame, which answers in one glance
what a failure count cannot.

---

## 11. Where this is now

| | |
|---|---|
| cards indexed | **54,637** across four indexes |
| Pokémon EN / JA | 20,276 / **23,533** |
| One Piece EN / JA | 5,809 / 5,019 |
| index size on the wire | 2.6 – 12 MB each |
| a printed number that names one card | **41% EN, 33% JA** (§5) |
| comparison against the candidates | ~8 ms, plain JS |
| one inference | **70 ms** (WebGPU) · 530 ms (WASM) |
| **metered calls per photo scan** | **1** — Vision, capped at 33/day |

**That last row said `0` until 2026-09-13**, left over from the arrangement where
the reader was a fallback. A photo scan spends a metered unit every time. The
budget survives it because the scan is account-gated and the real volume is
roughly 150 scans in total — there is no quota to protect, which is also why the
second OCR engine was removed rather than kept.

Verified in a browser by driving the page's own file input: the reader path, the
tie chooser, and the four states of the Vision chip.

---

## 12. How to scale with it — in the order that will actually bite

**1. The margin threshold, before anything else.** n = 5. Every confidence
decision the product makes rests on it, and the one failure that rewrote the
photo path was a wrong card clearing it by a thousandth — 0.016 against 0.015.
Twenty labelled photographs would turn a hypothesis into a number, and that is an
afternoon with a phone.

**2. The 386 cards with no picture**, and specifically the 98 `#DPBP` ones, which
have never been checked and may not be cards at all. That check costs nothing and
no third party a single request — it is a question for TCGdex's own API. If they
are phantoms like the fifteen `CS` sets, a quarter of the problem disappears
without anyone fetching anything.

**3. Index size, at about 4× from here.** 20k × 512 int8 is 10 MB and searches in
8 ms. Both scale linearly, so 200k cards is 100 MB and 80 ms — the download breaks
first, not the search. When that day comes the answer is not a vector database (a
network hop of 20–50 ms against a search of 8), it is **shipping fewer dimensions
or fewer cards**: PCA to 128 dimensions is a 4× cut, and most scans only ever need
the sets people actually own.

**4. ~~Speed~~ — done, and it matters here too.** The same ~500 ms on desktop and
phone was the signature of a WASM runtime rather than a CPU, and WebGPU is a
different execution path rather than a faster one of the same kind:

```
              per match
  WASM          530 ms
  WebGPU         70 ms
```

On a photograph that is one inference, not thirty a second, so it is felt as
latency rather than as frame rate. WASM remains the fallback — WebGPU is absent
on most iOS and can fail at adapter request even where the API exists.

**5. The two photographs that still fail.** A Greninja ex and a slabbed Gengar ex,
both in `img test/`, and in both the wrong card at rank one was already indexed
before any of this year's work. They are the only labelled failures on file, which
makes them worth more than their number suggests.

**What does NOT need to change:** the comparison (8 ms against a handful of
candidates is not a bottleneck at any size this product will reach), the storage
(int8 vectors on disk, no database), or the free-tier discipline everywhere except
the reader — `scripts/check-free-tier.mts` fails the build if anything else starts
spending quota.

**Parked, not abandoned:** the live camera view, and with it the per-frame vote,
the card detector and the main-thread work. See `docs/live-scan-parked.md`, which
holds the measurements those needed.
