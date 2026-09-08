# Toward a live video scan

Written 2026-09-08, in answer to: *what do we need so a card held up to the
camera is identified as it moves?*

Everything below that is a number was measured on this machine, on this
catalogue, tonight. Where something is an estimate it says so.

---

## 1. The finding that decides the architecture

**A whole-catalogue artwork match runs in the browser in 0.25 ms.**

A linear scan comparing one 64-bit perceptual hash against 60,000 cards —
larger than our real corpus — takes 0.25 ms single-threaded in plain JavaScript.
That is ~4,000 frames per second against a camera that delivers 30.

| what | size |
| --- | --- |
| 64-bit hash per card, 60k cards | **469 KB** |
| hash + 3 colour floats (what `lib/art-rank.ts` already uses) | 1.2 MB |
| 256-bit hash, if we ever need the precision | 1.9 MB |

So the index **ships to the browser**. No server round trip per frame, no vector
database, no approximate-nearest-neighbour library, no GPU. Those tools exist
for corpora a thousand times this size; at 60k they would be strictly slower
than the loop we can write in an afternoon.

**This means matching is not the hard part, and never was.** Every remaining
problem is about having the right data and getting a clean picture of the card.

---

## 2. Where the time actually goes, today

Measured before and after tonight's change:

| step | before | after | note |
| --- | --- | --- | --- |
| cold catalogue load | 101 ms | 101 ms | once per server process |
| `allEntries()` per query | 82 ms | **0 ms** | was re-grouping 33,847 entries per set |
| label derivation per query | 73 ms | **0 ms** | now stamped once at load |
| the actual filter | 3 ms | 3 ms | |
| **search, `q=charizard`** | **290 ms** | **9 ms** | |
| page, warm, end to end | — | **75–110 ms** | `/cards`, `/cards/one-piece`, a set page |

The two costs removed were both *rebuilding at request time something fixed
between crawls*. That is the shape of nearly every remaining slowdown too.

**What is left on the search path is small and known**: ~40 ms on an empty
query, which is facet counting over the whole corpus. Worth fixing when it
matters; irrelevant to the camera.

---

## 3. Signatures — was the gap, now closed

When this was written we held artwork signatures for One Piece and **none at
all** for Pokémon, which is why the scan could rank One Piece printings by
looking at them and could only order Pokémon candidates by the script they were
printed in.

| corpus | cards | signatures |
| --- | --- | --- |
| One Piece (en + ja) | 10,828 printings | **10,828** |
| Pokémon English | 23,546 | **21,762** (92%) |
| Pokémon Japanese | 12,781 | **8,449** (66%) |

**Done 2026-09-08.** `scripts/pokemon-art-signatures.mts`, 30,211 signatures,
1.8 MB, ~9 minutes. The Japanese ceiling is image availability, not the script:
4,330 of those cards are pictured nowhere public.

`scripts/pokemon-art-signatures.mts` does for Pokémon what the One Piece pass
already did: fetch each image once, hash it, store 64 bits plus three colour
floats, skip anything already signed. Two sources, matching where the
catalogue's pictures come from — TCGdex's asset host, and the official Japanese
card site for the 4,569 cards only the mirrored official data pictures.

`lib/pokemon-art.ts` reads them, and the scan uses them: when EVERY Pokémon
candidate is signed, the group is ordered by how much each looks like the
photograph. All-or-nothing, like the One Piece ranker — a candidate with no
signature cannot lose a comparison it never entered, so a partial set would
quietly promote whichever cards happen to be covered.

Measured against a real card image: a photo of Base Set Charizard scores
**0.000** against itself and **0.673** / **0.808** against the other cards
printed `004/102`.

The remaining ceiling is not the script. 4,330 Japanese cards are pictured
nowhere public, and `048/082` — the Japanese Gengar — is still ordered by name
and script because neither Japanese candidate has a picture for anyone.

---

## 3b. Corrected 2026-09-09 — the ordering below is wrong

Real photographs arrived and were measured (`docs/clip-scan-research.md` §1).
Against the cards in them, matched by artwork with the search scoped to one
language:

  clean publisher scans     8/8, margin 0.091
  the same photographs      2/8 as shot, 4/8 centre-cropped, margins ~0.01

The model is not the limit. A photograph contains a hand, a hallway and a
shelving unit, and the card fills half the frame; the embedding is faithful to
all of it. **Detection and rectification (§4.2) is step 1, not step 3.**
Everything downstream is answering a different question until it exists.

## 4. What a live scan actually needs

Four steps per frame. Only one is unsolved.

### 4.1 Get the frame — solved, browser-native

`getUserMedia` for the camera, and `HTMLVideoElement.requestVideoFrameCallback`
to run once per *delivered* frame rather than once per `requestAnimationFrame`.
The latter matters: it stops us hashing the same frame twice and burning
battery. Both are standard, no dependency.

### 4.2 Find the card in the frame — the real work

A photograph of a card held in a hand is not a card scan: it is rotated, keystoned,
lit from one side, and surrounded by a room. Everything downstream assumes a
rectified 600×838 card face.

This is the step that needs a library, and the honest options are:

- **OpenCV.js** (WebAssembly, ~8 MB, Apache-2.0, free). Canny edges →
  `findContours` → largest four-point contour → `getPerspectiveTransform` →
  `warpPerspective`. This is the classic document-scanner pipeline and a card is
  an easier case than a document: fixed aspect ratio (2.5 : 3.5), high contrast
  border, known size. **This is the one substantial dependency I would add.**
- **A hand-written corner detector.** Feasible — threshold, contour trace,
  quad fit — and roughly a week of work to make robust against glare and dark
  backgrounds. Not worth it against a free, battle-tested implementation.
- **A trained model** (TensorFlow.js / ONNX Runtime Web). Overkill: we are
  detecting a rectangle, not recognising an object.

Guard: the 8 MB WASM download must be lazy, loaded only when the camera opens,
never on the catalogue pages we just made fast.

### 4.3 Hash the rectified face — solved, ours already

`lib/art-rank.ts` crops the art region, normalises brightness, and produces
chroma + 64 dHash bits. It runs on a `Buffer` via sharp today; the same maths on
a `<canvas>` `getImageData` is a direct port and is sub-millisecond at 9×8.

**One thing to verify by experiment**: our signatures are computed from
publisher scans, and the camera sees a *photograph* of a card — different white
balance, glare, a phone's colour pipeline. The brightness normalisation already
in `art-rank.ts` was written for exactly this, and the artwork ranking works
today on real photographs through the Vision path. But the distances will be
larger than scan-to-scan, and the threshold has to be re-measured against
photographs rather than assumed.

### 4.4 Match — solved, 0.25 ms

Section 1. Add temporal smoothing: require the same card to win N consecutive
frames before showing it, so the answer stops flickering while the card moves.

---

## 5. What this replaces

Today's scan sends the photo to **Google Vision**, reads the card code, and
resolves it. That path stays valuable and should not be deleted:

- Vision reads the *printed number* and the *name*, which artwork alone cannot
  distinguish between two printings of the same picture.
- It is metered — 900/month self-imposed under a 1,000 free ceiling — and one
  request per video frame is obviously impossible.

**So the two are complementary, and the split is natural**: artwork matching
runs continuously on device and costs nothing; Vision runs **once**, when the
person confirms, to disambiguate the printing. That is a better use of the quota
than what we do now, and it makes the live view free.

---

## 6. Tools

### Already in the project and sufficient

| tool | for |
| --- | --- |
| `lib/art-rank.ts` | chroma + dHash, thresholds measured against real photographs |
| `scripts/one-piece-art-signatures.mts`, `scripts/pokemon-art-signatures.mts` | incremental signature generation, both games |
| `lib/pokemon-art.ts` | 30,211 Pokémon signatures, by TCGdex id |
| `sharp` | server-side image work; not needed on the client path |
| Google Vision | the printed number and name, once per confirmed scan |

### To add — free, and I would add exactly these

| tool | why | cost |
| --- | --- | --- |
| **OpenCV.js** | card detection and perspective rectification (§4.2) | 8 MB WASM, lazy-loaded, Apache-2.0 |
| **`requestVideoFrameCallback`** | one hash per delivered frame | browser API, no dependency |
| **A Web Worker** | keep hashing and matching off the render thread | browser API, no dependency |

### Considered and rejected, with the reason

| tool | why not |
| --- | --- |
| a vector database (Pinecone, Qdrant, pgvector) | 0.25 ms linear over 60k. A network hop alone is 20–50 ms |
| an ANN index (hnswlib, faiss) | builds an index to avoid a scan that takes 0.25 ms |
| TensorFlow.js / ONNX Runtime Web embeddings | a learned embedding beats a perceptual hash on *photographs of scenes*; on flat printed artwork the hash is already near-exact, and this costs megabytes and milliseconds per frame |
| Tesseract.js on device | we removed it for Vision because it misread real cards; nothing has changed |
| server-side frame processing | one upload per frame, metered, and slower than doing it locally |

---

## 7. Sequenced plan

Each step is independently useful, and each is verifiable before the next.

1. ~~**Pokémon artwork signatures.**~~ **Done.** 30,211 signatures, 1.8 MB.
   The scan now ranks Pokémon candidates by artwork when every candidate is
   signed: measured, a photo of Base Set Charizard scores 0.000 against itself
   and 0.673 / 0.808 against the other cards printed `004/102`. When one
   candidate is unsigned the whole group keeps the name-and-script order, which
   is still what happens to the Japanese Gengar — neither Japanese candidate
   for `048/082` is pictured anywhere public.
2. **Ship the index to the browser.** One static file, 469 KB, cached
   immutably. Verify the same match happens client-side as server-side.
3. **Re-measure the threshold against photographs**, not scans. Take 20 photos
   of known cards, measure the distance distribution, and set the accept
   threshold where it separates — the same method used for the One Piece
   printing aliases (control p1 = 0.393, threshold 0.05).
4. **OpenCV.js rectification**, lazy-loaded, behind the camera view only.
5. **Live view**: `requestVideoFrameCallback` → worker → hash → match →
   confirm after N consecutive agreeing frames.
6. **Vision once, on confirm**, to pin the exact printing.

---

## 8. How you can help

Three things, in order of how much they unblock:

1. **Photographs.** 20–30 photos of cards you own, taken the way you would
   actually scan them — hand-held, normal room light, whatever angle is
   natural. This is the only thing I cannot generate, and step 3 above is
   impossible without it. Both games, and a few Japanese ones.
2. **Tell me the acceptable failure.** When the live view is unsure, should it
   show nothing, show its best guess greyed out, or hold the last confident
   answer? This changes the threshold more than any algorithm does.
3. **Confirm the OpenCV.js dependency.** It is 8 MB of WebAssembly, lazy, only
   on the camera page, Apache-2.0. It is the one non-trivial thing I would add,
   and I would rather you knew before it is in the tree.

---

## 9. Honest unknowns

- **Photograph-to-scan distance is unmeasured.** Artwork ranking works today on
  real photos, but between *printings of one card*, where the candidate set is
  ten. Against 60,000, the threshold question is different and I have no data.
- **Pokémon printings share artwork.** 0 of 10,110 multi-variant Pokémon cards
  have a distinct image (measured, `docs/free-tier-catalogue.md` §1). Artwork
  can identify the *card* and never the *printing* — that is Vision's job, and
  it is why §5 keeps both.
- **4,330 Japanese cards are pictured nowhere public.** They cannot be matched
  by artwork at all, by anyone, until a source appears.
- **Glare and sleeves** are the usual failure of this pipeline and I have no
  measurement of how bad they are here. The photographs in §8 would answer it.
