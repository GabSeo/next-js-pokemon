# CLIP for card identification — what I measured, and what I built

Written 2026-09-08, in answer to: *the scan works on imported HD photos and
fails on every test with my phone; would CLIP be 10× better?*

Everything numbered here was measured on this machine, on this catalogue,
tonight. Where a number is an estimate it says so.

---

## 1. The short answer

**Yes, and I built it — but the honest number is not 10x, and the first
experiment I ran overstated it.**

### Measured against the real index: 30,219 cards

Eight known cards, degraded, matched against every Pokémon card we have a
picture of. This is the number that counts, because telling a card from 30,000
is the actual job.

| degradation | top-1 | margin when right |
| --- | --- | --- |
| clean scan (control) | **8/8** | 0.091 |
| blur 1.0 (slight shake) | **8/8** | 0.072 |
| blur 2.0 | **8/8** | 0.067 |
| blur 3.2 (heavy) | 6/8 | 0.062 |
| glare 0.25 (a soft sheen) | **8/8** | 0.070 |
| glare 0.55 (a hard band) | 7/8 | 0.067 |
| keystone 7% (slight angle) | **8/8** | 0.052 |
| keystone 14% (marked angle) | 7/8 | 0.041 |
| tungsten white balance | 6/8 | 0.054 |
| **realistic mix** — slight blur + angle + sheen + dim | **7/8 — 88%** | 0.043 |
| harsh mix — all of the above at maximum | 2/8 | 0.014 |

**THE MARGIN IS THE CONFIDENCE SIGNAL**, and it falls cleanly: 0.091 on a clean
scan, 0.043 on a realistic photograph, 0.014 where the answer is usually wrong.
That answers your failure-mode question with data rather than taste — a live
view can say "not sure" by thresholding the gap between the first and second
score, and it will be right about being unsure.

**White balance is the single worst degradation** (6/8, worse than heavy blur).
That is actionable and cheap: a grey-world white balance pass before embedding
should recover most of it, and it is the first thing to try in §5.

### The earlier experiment, and why I am reporting it as wrong

I first ran this against a 498-card pool and got hash 40% / CLIP 73% on the
combined case. Against the full 30,219 the same harsh combination gives CLIP
**2/8**. Telling a card from 498 is a far easier problem, and I should not have
led with it. The 498-card table is still in git history; the table above
replaces it.

What survives from that run, and matters: on any SINGLE degradation both
approaches do well. It is the combination that separates them, and a real
photograph is always a combination.

### What is still unmeasured

**Your phone.** Every degradation above is synthetic — written to be plausible,
not sampled from reality. Real sensor noise, real motion blur and real foil
behave differently, and I have no way to know how differently.

`scripts/clip-match.mts` exists so you can settle this in five minutes: put
photographs in a folder, name each file after the card it shows
(`base1-4.jpg`), and run it. It prints the top matches, the margin, and the
top-1 rate.

## 2. Where CLIP should run — and why your prompt's architecture would not fit

Your brief proposed Python `sentence-transformers`, a `vector(512)` column in
Postgres with **pgvector**, or a **Qdrant** instance under Docker, and an
`/api/scan` endpoint receiving each frame.

Every one of those is a reasonable default. Measured against this project they
are all the wrong size, and two collide with the constraint that governs
everything here — no paid server, no metered call on a free path.

### Measured

| | |
| --- | --- |
| cosine over 30,000 × 512, float32, plain JS | **8.2 ms** (122 fps) |
| the same, int8 | 8.7 ms |
| index as float32 | 59 MB |
| index as **int8** | **15 MB** — shippable to a browser |
| CLIP inference, fp32, Node | 14.2 ms (70 img/s) |
| CLIP inference, **int8**, Node | **5.4 ms** (185 img/s) |

### So

- **No vector database.** pgvector and Qdrant solve a problem that begins a
  thousand times further up. At 30k the search is 8 ms; a network hop to reach
  either is 20–50 ms. They would make it *slower*, and add a service to run.
- **No approximate-nearest-neighbour index.** Same reason: an index built to
  avoid a scan that takes 8 ms.
- **No Python.** `@huggingface/transformers` runs the same ONNX weights in Node
  and in a browser. The vector this repo writes and the vector a phone computes
  from a video frame then come from one implementation rather than two that
  must be kept agreeing.
- **No frame upload.** The index is 15 MB and the model is ~25 MB quantised.
  Both cache. Uploading every frame instead would cost bandwidth, a Vercel
  invocation each, and more latency than doing the whole thing locally.

### The architecture that fits

```
phone, in the browser                          repo, offline
─────────────────────                          ─────────────
camera frame                                   TCGdex / official JP scans
  ↓  OpenCV.js: find quad, reject blur              ↓  scripts/pokemon-clip-embed.mts
  ↓  warpPerspective → 224×224                      ↓  CLIP ViT-B/32 (q8)
  ↓  CLIP q8 in WASM        ~30–70 ms est.          ↓  L2-normalise → int8
  ↓  512 int8                                       ↓
  └─→ dot product vs the shipped index  8 ms  ←──── data/catalog/pokemon-clip/*.i8
        ↓
      top-1 + score, on device, no server, no quota
```

Estimated per frame: **50–100 ms → 10–20 fps.** A live scan does not need 30.

**Vision keeps exactly one job**, and it is the right one: once, on
confirmation, to read the printed number and pin the *printing*. Which brings
us to the rule you stated, and it is the most important sentence in your brief.

---

## 3. The artwork identifies the card, never the printing

Measured in this repo and already load-bearing elsewhere: **0 of 10,110
multi-variant Pokémon cards have a distinct image.** A normal, a holo and a
reverse holo are the same artwork at the pixel level on every publisher scan.

So no embedding — CLIP or otherwise, at any resolution — can separate them.
This is not a limitation of the model; the information is not in the picture.

That makes your two-pass design correct, and it is worth being exact about what
each pass can do:

1. **Pass 1, identity.** CLIP → the base card. Solvable, and now measured.
2. **Pass 2, printing.** *Not* an image-similarity problem. The signals are the
   holo pattern (a texture, not an artwork), the set symbol, and the printed
   number — the things Vision already reads. Doing it as "detect stamps by OCR
   or analyse local luminous texture" is the right instinct, and it is a
   separate project with its own measurement.

---

## 4. What I built tonight

- **`scripts/clip-vs-hash-lab.mts`** — the experiment above, re-runnable with
  `--candidates` and `--queries`. It is a lab script, not part of the build.
- **`scripts/pokemon-clip-embed.mts`** — the ingestion. Fetches each card's
  publisher scan (TCGdex, plus the official Japanese site for the 4,569 cards
  only it pictures), runs CLIP ViT-B/32 q8, L2-normalises, quantises to int8,
  and writes a binary blob plus a manifest of ids in the same order.
  Incremental, so a new set costs the new set.

  Output: `data/catalog/pokemon-clip/<lang>.i8` and `<lang>.json`.

- **`@huggingface/transformers`** added as a dependency, used only by scripts so
  far.

### Two implementation notes that cost time and will cost yours

- **The library's own image path is broken for our files.** `RawImage.fromBlob`
  and the image processor both route through the sharp bundled *inside* the
  transformers package, which fails on TCGdex's webp with `colourspace:
  parameter space not set` — on decode, and again on resize. Both scripts do
  CLIP's preprocessing with our own sharp instead: resize 224 bicubic, rescale,
  subtract the channel means, divide by the deviations. A browser will do the
  same on canvas pixels, so this is not a workaround so much as the shape the
  client needs anyway.
- **Load `CLIPVisionModelWithProjection`, not `AutoModel`.** The latter loads
  the full CLIP and then demands `input_ids` it has no text for.

---

## 5. What is left, in order

1. **Ship the index to the browser.** One static `.i8` per language, cached
   immutably, plus the manifest. Verify a client-side match agrees with a
   server-side one on the same image.
2. **CLIP in the browser.** `@huggingface/transformers` with the WASM backend,
   q8 weights, in a Web Worker. **Measure it** — my 30–70 ms is an estimate
   scaled from Node, and a mid-range Android is the case that matters.
3. **OpenCV.js**, lazy-loaded only when the camera opens: contour → largest
   quad at 2.5 : 3.5 → Laplacian variance to reject blur → `warpPerspective`.
   This is your §3.A and I have not started it.
4. **The auto-trigger**: stable quad + sharp for >200 ms → embed → match →
   require N consecutive agreeing frames before showing an answer.
5. **Vision once, on confirm**, for the printing.

### What I need from you

1. **The 20–30 phone photographs.** They convert §1's caveats into numbers and
   set the accept threshold. Nothing else unblocks as much.
2. **Confirm OpenCV.js** — 8 MB of WASM, lazy, camera page only, Apache-2.0.
3. **Decide the failure mode**: when the live view is unsure, show nothing,
   show a greyed-out guess, or hold the last confident answer? This moves the
   threshold more than any model choice.

---

## 6. Honest risks

- **The browser inference number is unmeasured.** If WASM CLIP turns out to be
  300 ms on a mid-range phone rather than 50, the live scan becomes a
  "hold still" scan. Still useful, but a different product. This is the first
  thing to measure in step 2, before building the camera UI on top of it.
- **First load is ~40 MB** (25 MB model + 15 MB index). Cached afterwards, and
  acceptable for an account-gated premium feature, but it is real and it should
  be a deliberate, visible download rather than something that happens while
  someone waits.
- **4,330 Japanese cards are pictured nowhere public.** They cannot be embedded
  by anyone, and no model changes that.
- **CLIP is a general model.** It was trained on internet images, not on
  trading cards. A card-specific fine-tune would very likely beat it — and
  would need labelled photographs, which is the same thing I am asking for in
  §5 and a much larger quantity of it. Not now; worth knowing the ceiling is
  not here.
