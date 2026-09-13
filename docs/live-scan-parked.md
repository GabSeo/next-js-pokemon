# The live camera scan — parked, with its measurements

**Parked September 2026.** The live view works and is not being developed. This
document is what was measured while building it, kept unchanged, because the
measurements are real and re-deriving them would cost weeks.

`docs/how-the-scan-works.md` is about the photo scan, which is the one in use.
Three sections that were written here stayed there instead, because a photograph
depends on them: the two thresholds (`scan-client.tsx` imports them), the
resampling test (it says a browser's `drawImage` may query an index built with
sharp), and "twenty real cards, one match" (measured on phone photographs).

**What is still in the code**, should this be picked up again:

| | |
|---|---|
| `src/app/scan/live-scanner.tsx` | 920 lines, the camera loop and the hold panel |
| `src/lib/card-detect.ts` | 492 lines, the detector below |
| `src/lib/clip.worker.ts` | shared with the photo scan — do not delete |
| `src/lib/clip-search.ts` | shared, and holds the thresholds |

Nothing was removed. The button that opens it is still on `/scan`.

---

## Where it stood

```
2.1 frames a second (WASM) · 11.8 (WebGPU)
identified swsh12-150 in 574 ms
main-thread delay while scanning: 0 ms median, 0.1 ms p95
```

Verified in a browser with a synthetic camera, and on a real phone for the
lag report that prompted the worker.

---

## The open question that was never answered

The reasoning that kept it out was "a metered per-image call cannot run thirty
times a second", and that is true and beside the point. **The live view does not
need a reader per FRAME.** It already decides when its evidence has settled —
that is what the vote is for — and at that single moment it could send one image
to be read, exactly as the photo path does.

One call per card scanned, not per frame. On the Eustass Kid that would have
turned Kalgara into `OP05-074`.

It is not built, and the argument against it was weaker than it looked.

---

## Finding the card

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

---

## What the live view does per frame

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

## The three viewfinder states

The thresholds themselves, and why each number is what it is, are in
`docs/how-the-scan-works.md` §6 — they outlived this feature. What belongs here
is only what the camera does with them:

```
score < 0.50                    "Point the camera at a card"
score high, margin < 0.015      "Hold steady — fill the frame"
both above                      the card
```

A flat grey wall scores 0.3568 with a margin of 0.0231 — above
`CLIP_CONFIDENT_MARGIN`. Without the floor, a live view would name a card,
confidently, at a wall. That is the whole argument for having two.

---

## What scaling it would need, in order

**1. The detector, which is a data problem before it is a model problem.** The
ceiling measurement says corners are worth 3/4 → 4/4. The available Roboflow
datasets are cards **lying flat**, often slabbed — not cards held in a hand, which
is every real photograph. Training on them would produce a detector good at the
wrong thing. Getting there needs our own annotated photographs first, and the
licence question is settled: not Ultralytics (AGPL-3.0, viral across a network
service), but RF-DETR, RT-DETR, D-FINE or YOLOX, all Apache-2.0.

**2. Reading the code once per card**, not per frame — the open question above.
It is the single change most likely to make this feature work, and the argument
against it was weaker than it looked.

**3. ~~The main thread~~ and ~~speed~~ — both done**, and both already paid for.
Inference runs in a Web Worker; WebGPU took a match from 530 ms to 70 ms, which on
a live view is accuracy and not just smoothness, because the vote accumulates
across frames.
