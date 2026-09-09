# How the scan works — and how to scale with it

The companion to `docs/pokemon-catalogue-pipeline.md`. That one explains where the
references come from; this one explains what happens to a photograph, why each
threshold is the number it is, and what breaks first when this grows.

Every figure is measured, and the script that measured it is named. Measured
2026-09-09.

---

## 1. The whole thing, in one paragraph

You point a camera at a card. The browser crops a card-shaped region, turns it
into 512 numbers with a model it downloaded once, and compares those numbers
against 51,000 reference cards it also downloaded once. The nearest match is the
card. **Nothing is uploaded, nothing is metered, and there is no server in the
loop** — the only network call is fetching the card's own details once it has
been named.

---

## 2. The pipeline

```
camera frame  ─┐
photo upload  ─┴─→  crop to a card-shaped region      (browser, ~0 ms)
                    ↓
                    resize 256x256, rescale 0..1      (canvas)
                    ↓
                    MobileCLIP-S2 fp16  →  512 floats (WASM, ~450 ms)
                    ↓
                    cosine against 20k int8 vectors   (plain JS, ~8 ms)
                    ↓
                    score floor + margin  →  a verdict
                    ↓
              ┌─────┴─────┬──────────────┐
           empty        unsure       identified
      "point at a    "fill the     resolve the card
        card"          frame"      (/api/scan/resolve)
```

The fallback, when the artwork cannot place a picture: Google Vision reads the
printed code and the catalogue looks it up. That path is **metered at 33/day** and
is the only metered thing anywhere near the scan.

---

## 3. Why the model runs in the browser

The model is **68 MB** of ONNX weights. On Vercel that is re-downloaded on every
cold start of a serverless function, which puts an unpredictable multi-second
penalty in front of a feature whose entire proposition is speed.

In a browser it is fetched once and cached. And it has to be there anyway: **a
video feed cannot post thirty frames a second to a server.**

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

## 4. The two thresholds, and why one is not enough

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

The two produce three honest states, and the live view says all three:

```
score < 0.50                    "Point the camera at a card"
score high, margin < 0.015      "Hold steady — fill the frame"
both above                      the card
```

---

## 5. Framing is the whole game, and there is no detector

Nothing here finds the four corners of a card in a frame. A card-shaped guide is
drawn on screen and only that region is read — **the person holding the phone is
the detector.**

That is not a placeholder so much as the honest version of the same job. From the
table above: a card filling a fifth of the frame scores 0.759 with a margin of
0.0012 — recognisable as a card, impossible to name. Cropping is what closes that
gap; a detector would do it automatically rather than better.

What a real detector would buy, measured by hand-annotating four corners on real
photographs and rectifying with a homography (`scripts/rectify-ceiling-lab.mts`):

```
as shot          3/4
hand-rectified   4/4
```

The guide already captures most of that, because the guide IS the crop. What it
cannot do is correct perspective: a card tilted toward the camera is a trapezoid,
and only four real corners fix that.

---

## 6. What the live view does per frame

- **One frame at a time.** The loop reads a frame only when the previous match has
  finished, so it self-paces. Firing on a timer would queue work faster than it
  completes and fall further behind the camera every second.
- **Two agreeing frames before an answer.** A single frame's verdict flickers as
  hands move and focus hunts. `AGREEING_FRAMES = 2` costs about a second and
  removes the class of bug where a card flashes up because one blurred frame
  landed near something.
- **The match runs on another thread.** The first version ran it where React
  runs, and the camera preview stuttered — reported from a real phone as
  "everything seems laggy". A 60 ms yield between frames was tried and did not
  help, because the block is the 450 ms match itself, not the gap between
  matches. The main thread now decodes one bitmap per frame and waits.
- **Found means stop.** Leaving the camera running behind a result keeps the phone
  warm and invites the next frame to overwrite an answer someone is still reading.

Measured in a browser, driving the loop with a synthetic camera:

```
2.1 frames a second
identified swsh12-150 in 574 ms
```

---

## 7. The identity problem, per game

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

**One Piece is the more precise of the two.** It separates `ST21-014` from
`ST21-014_p1` — two printings of the same card — which Pokémon can never do.

---

## 8. What is asked rather than guessed

Two questions, because nothing in a picture answers either:

- **Which game.** There is no signal in the artwork. When there was an index for
  Pokémon and none for One Piece, a photographed Luffy was searched against 41,500
  Pokémon vectors and confidently answered with a Koffing.
- **Which language.** An English card and its Japanese release share artwork
  exactly, so searching both returns two answers for one card and forces the
  reader to break a tie the picture cannot break.

All four indexes are in **one embedding space**, which is what would let a later
version search all of them and drop both questions. That needs measuring first:
two catalogues in one search is two chances to be confidently wrong.

---

## 9. Where this is now

| | |
|---|---|
| cards indexed | **51,528** across four indexes |
| Pokémon EN / JA | 20,276 / 21,224 |
| One Piece EN / JA | 5,809 / 5,019 |
| index size on the wire | 2.5 – 10 MB each |
| search across 20k vectors | ~8 ms, plain JS |
| match end to end | ~500 ms warm |
| live frame rate | **2.1 fps** |
| main-thread delay while scanning | **0 ms median, 0.1 ms p95** |
| metered calls on the fast path | **0** |

Verified in a browser: photo scan, tie chooser, live camera, and all three live
states.

---

## 10. How to scale with it — in the order that will actually bite

**1. ~~The main thread~~ — done.** Inference used to block it; it now runs in a
Web Worker (`lib/clip.worker.ts`). Measured on the page with a MessageChannel
probe, 388,087 samples over five seconds while the loop ran: **median main-thread
delay 0 ms, p95 0.1 ms**. One 634 ms outlier, which is the worker's first model
load rather than a per-frame cost.

A note on how that was nearly measured wrong: the same probe using `setTimeout`
reported a 683 ms median, which looked exactly like the bug still being there. It
was Chrome throttling timers in a hidden tab to roughly one a second. A
measurement taken through a throttled clock says nothing about the thing being
measured.

**2. Speed, which is not a device problem.** Same ~500 ms on desktop and on a
phone. That is the signature of a WASM runtime, not of a CPU — the fix is
**WebGPU**, which transformers.js supports and which nothing here has tried. A
faster phone will not help; a different backend might, by a lot.

**3. Index size, at about 4× from here.** 20k × 512 int8 is 10 MB and searches in
8 ms. Both scale linearly, so 200k cards is 100 MB and 80 ms — the download breaks
first, not the search. When that day comes the answer is not a vector database (a
network hop of 20–50 ms against a search of 8), it is **shipping fewer dimensions
or fewer cards**: PCA to 128 dimensions is a 4× cut, and most scans only ever need
the sets people actually own.

**4. The detector, which is a data problem before it is a model problem.** The
ceiling measurement says corners are worth 3/4 → 4/4. The available Roboflow
datasets are cards **lying flat**, often slabbed — not cards held in a hand, which
is every real photograph. Training on them would produce a detector good at the
wrong thing. Getting there needs our own annotated photographs first.

**5. The margin threshold, before any of the above.** n = 5. Every confidence
decision the product makes rests on it. Twenty labelled photographs would turn a
hypothesis into a number, and that is an afternoon with a phone.

**What does NOT need to change:** the search (8 ms is not a bottleneck at any size
this product will reach), the storage (int8 vectors on disk, no database), or the
free-tier discipline (nothing on the fast path is metered, and
`scripts/check-free-tier.mts` fails the build if that stops being true).
