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

## 5. Finding the card

The live view locates the card itself: gradient, threshold, convex hull,
simplify to four points, then a homography that straightens it. No model, no
download, no licence — `lib/card-detect.ts`.

### It was graded properly, and that changed it

The first two versions were built and graded on **four** photographs with
corners read off by eye, and both measured worse than doing nothing. That is a
useful result at n=4 and not a trustworthy one.

"Pokemon Card Detection 3" (Roboflow Universe, **CC BY 4.0**) is 1,509 images
with a `Card` polygon on each — the same ground truth, three hundred times over.
`scripts/detect-grade.mts` scores the found quadrilateral against the annotated
one by IoU, over every image including the ones it declines.

**The single most useful thing it produced was proving a hypothesis backwards.**
A card's border is under 1% of a frame's pixels, so the obvious move was to keep
fewer and stronger edges. Every step that way made it worse:

| edge pixels kept | found a quad | IoU ≥ 0.8 | IoU ≥ 0.5 | median |
|---|---|---|---|---|
| 1% | 3% | 0% | 0% | 0.374 |
| 10% *(the original guess)* | 69% | 27% | 47% | 0.689 |
| **24%** | **91%** | **45%** | **81%** | **0.804** |
| 50% | 95% | 20% | 69% | 0.594 |

More edge pixels give a more complete hull, and a complete hull is what the
corner search needs. Confirmed on the held-out `test` split at the tuned value:
**90% found, 71% IoU ≥ 0.5, median 0.784** — close enough to the tuning split to
say it generalises rather than memorises.

### What the export can and cannot say

Every image is stretched to 432×432 and converted to greyscale. So it grades
**corner-finding** and can say nothing about **identification** — a colour
matcher cannot be tested on grey pictures. The stretch also means a card in it
has an aspect near 1.0, so the shape test has to be switched off to measure at
all, which the grader does explicitly rather than by quietly widening a default.

### Someone else walked this exact path and ended up somewhere else

From ankush.one's write-up of building a Pokémon scanner:

> the opencv rectangle contour thingie to crop out cards works okay for still
> images, [but] it failed drastically for video streams … so I ended up training
> a YOLO11n model on a pokemon cards dataset, and it worked pretty well and
> really fast, while also being around 5mb

That is the same split this measured from the other side: **90% on still
images**, and a live view that could not hold an answer. Stills and video are
not the same problem, and grading on a dataset of stills cannot tell you which
one you have.

So a small trained detector is very likely the answer. One caveat that decides
*which* one: **YOLO11 is Ultralytics, and Ultralytics is AGPL-3.0** — viral
across a network service, which this is. RF-DETR, RT-DETR, D-FINE and YOLOX are
Apache-2.0 and do the same job. The dataset is CC BY 4.0 either way, so the
licence question is entirely about the model, not the data.

### The guide is still there, as the fallback

The detector declines on about one frame in ten, and the centre crop is a better
guess than nothing on those. It fades when the detector is answering, so nobody
lines up a rectangle that nothing is reading.

## 6. What the live view does per frame

- **One frame at a time.** The loop reads a frame only when the previous match has
  finished, so it self-paces. Firing on a timer would queue work faster than it
  completes and fall further behind the camera every second.
- **Evidence accumulates; no single frame has to be confident.** Three versions
  before this one asked whether THIS frame, alone, cleared both thresholds —
  first two consecutive frames had to, then two of the last six. Both were a
  conjunction of two rare events on a moving camera: sharp enough to clear the
  score floor AND separated enough to clear the margin. Reported as impossible
  to use, and it was. Every frame now adds each candidate's similarity to a
  running total, and the card actually present pulls ahead over a second or two
  without any frame ever settling it. Noise does not accumulate: a blurred
  frame's spurious best is a different card each time, and scattered votes
  cancel where a consistent one compounds.
- **The match runs on another thread.** The first version ran it where React
  runs, and the camera preview stuttered — reported from a real phone as
  "everything seems laggy". A 60 ms yield between frames was tried and did not
  help, because the block is the 450 ms match itself, not the gap between
  matches. The main thread now decodes one bitmap per frame and waits.
- **Found means stop.** Leaving the camera running behind a result keeps the phone
  warm and invites the next frame to overwrite an answer someone is still reading.
- **Hold: keep scanning, never conclude.** The vote settles in about a second and
  a half, which is the point of it and also why a scan that lands on the wrong
  card is impossible to study — the answer sheet covers the viewfinder before
  anyone can see what the frames were saying. Reported exactly that way. `Hold`
  stops the loop accepting and nothing else: frames are read, the vote
  accumulates and decays identically, and the standings go on screen instead of
  an answer. A debug view that scanned differently would be measuring itself.
  `Take the leader` accepts by hand, through the same resolve path the loop uses;
  `Clear` forgets the vote without reopening the camera, for comparing two cards
  back to back.

**Reading the hold panel.** It answers the one question this project keeps
needing to ask, and the same one a person with a card that will not scan is
asking:

| what it shows | what it means |
|---|---|
| the right card is **nowhere** in the five | the crop is wrong, or the card is not in the index — check the thumbnail top-left, which is the exact square being matched |
| the right card is there but **second or third** | the artwork is being separated and losing; the `−0.00x` column is by how much |
| every row is a different card each frame | nothing card-like is in the square at all |

Scores are shown as the running **average** per frame, not the sum: the sum
grows with the number of frames and shrinks with the decay, so its absolute value
says more about how long the camera has been open than about the card. Averaged,
it is directly comparable to the per-frame score in the corner panel.

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

## 8. Nothing is asked any more

Two questions used to stand in front of the camera — **which game** and **which
language** — and the reasoning was sound. Nothing in a picture answers either;
when One Piece had no index a photographed Luffy came back a Koffing; an English
card and its Japanese release share artwork exactly.

They are gone, because the person cannot answer them any faster than the machine
can, and two taps in front of "point the camera at a card" is the feature arguing
with its own proposition. All four catalogues are searched at once — 52,328
vectors instead of 20,276, about 12 ms instead of 8, and 26 MB of index instead
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

## 9. What real use says, and it is not what the tests said

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

## 10. Where this is now

| | |
|---|---|
| cards indexed | **51,528** across four indexes |
| Pokémon EN / JA | 20,276 / 21,224 |
| One Piece EN / JA | 5,809 / 5,019 |
| index size on the wire | 2.5 – 10 MB each |
| search across 20k vectors | ~8 ms, plain JS |
| match end to end | **70 ms** (WebGPU) · 530 ms (WASM) |
| live frame rate | **11.8 fps** (WebGPU) · 2.1 (WASM) |
| main-thread delay while scanning | **0 ms median, 0.1 ms p95** |
| metered calls on the fast path | **0** |

Verified in a browser: photo scan, tie chooser, live camera, and all three live
states.

---

## 11. How to scale with it — in the order that will actually bite

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

**2. ~~Speed~~ — done, and it was worth more than expected.** The same ~500 ms on
desktop and phone was the signature of a WASM runtime rather than a CPU, and
WebGPU is a different execution path rather than a faster one of the same kind:

```
              per match     frames / second
  WASM          530 ms          2.1
  WebGPU         70 ms         11.8
```

**And speed is accuracy here, not just smoothness.** The live view accumulates
evidence across frames, so frames per second and confidence are the same
quantity — three frames of evidence took a second and a half and now take a
quarter of one.

Verified alongside: the GPU's vectors still match an index built on a CPU (the
card identifies), and an empty scene still names nothing (the thresholds behave
the same). WASM remains the fallback — WebGPU is absent on most iOS and can fail
at adapter request even where the API exists.

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
