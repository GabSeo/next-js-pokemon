# Training the card detector

What the detector is, why the classical one is not enough, and the exact steps to
train a replacement. Written to be followed rather than read.

---

## 1. What "a small detector" actually is

A neural network of a few megabytes that takes an image and returns coordinates:
*there is a card, here are its corners*. That is all it does — it never identifies
the card, only finds it.

It matters because **the crop decides everything downstream**. The matcher
compares a 256×256 square against 51,528 reference scans, and those references
are clean, tightly-cropped card faces. If the square it receives contains a
table, a slab label, or a card that is off-centre and rotated, it is comparing
the wrong picture and the answer is wrong — which is exactly the symptom now:
answers arrive, and they are rarely the right card.

## 2. Why the classical detector is not enough

`lib/card-detect.ts` finds edges, takes their convex hull, and reduces it to four
points. Graded on 1,509 annotated **still images** it does well:

```
found a quadrilateral   90%
IoU >= 0.5              71%
median IoU              0.784
```

And it does not survive video. This is not a surprise in hindsight — the author
of ankush.one's Pokémon scanner hit the same wall from the other side:

> the opencv rectangle contour thingie to crop out cards works okay for still
> images, [but] it failed drastically for video streams … so I ended up training
> a YOLO11n model

**Why stills and video differ.** A still is the one frame a person chose: focused,
still, well-lit. A video frame is whatever arrived — motion-blurred edges, a
rolling shutter, glare sliding across slab plastic, autofocus mid-hunt. Edge
detection depends on edges being crisp, and half the frames in a live view do not
have crisp edges. A trained detector does not depend on that: it recognises the
*shape and appearance* of a card, and a blurred card still looks like a card.

That is also why other scanners appear to snap a box on instantly. They are not
finding edges better; they are not finding edges at all.

## 3. Which model, and the licence trap

**Not YOLO11.** It works and it is what the blog used, but YOLO11 is Ultralytics
and Ultralytics is **AGPL-3.0** — which is viral across a network service, and
this is a network service. Using it would mean publishing this codebase under
AGPL.

Permissive alternatives that do the same job:

| model | licence | notes |
|---|---|---|
| **RF-DETR** | Apache-2.0 | Roboflow's own, exports to ONNX cleanly |
| RT-DETR | Apache-2.0 | Baidu; heavier |
| D-FINE | Apache-2.0 | Newer, strong small variants |
| YOLOX | Apache-2.0 | Megvii, older but proven |

The **dataset** is CC BY 4.0 either way, so the licence question is entirely
about the model, never the data.

## 4. What we have

"Pokemon Card Detection 3", Roboflow Universe, CC BY 4.0, COCO segmentation:

```
train   1,341 images   3,126 annotations
valid     110 images     277
test       58 images     125
```

Two classes matter: `Card` (the outline) and `Name` (the title region). Every
image is 432×432, greyscale, auto-contrasted, and augmented with ±8° rotation
and ±36% brightness — which is a set built for exactly this training job.

**1,341 images is small for training from scratch and ample for fine-tuning.**
Every option above starts from COCO-pretrained weights that already know what an
object is; this only has to teach it what a card is.

## 5. The split of work

**This cannot be trained here.** There is no Python and no GPU in this repo, and
adding either would be a bigger change than the thing it serves. So:

| | who | where |
|---|---|---|
| Training | you | Google Colab, free GPU, ~30 min |
| ONNX export | the notebook | same place |
| Running it in the browser | me | `onnxruntime-web`, already a dependency |
| Wiring it into the scan | me | replaces `detectCard`, same interface |

The interface is already the right shape: `detectCard(rgba, width, height)`
returns four corners, and everything downstream — the homography, the crop, the
guide fallback — takes those corners without caring where they came from. The
trained model drops into that signature.

## 6. The steps

**1 — Upload the dataset to Colab.** The folder you already have
(`Claudy/roboflow dataset`), zipped, dragged into the file pane. Or re-export it
straight from Roboflow inside the notebook with your API key.

**2 — Install and train.** RF-DETR takes COCO directly, which is the format you
exported:

```python
!pip install rfdetr

from rfdetr import RFDETRBase
model = RFDETRBase()
model.train(
    dataset_dir="/content/roboflow dataset",   # expects train/ valid/ test/
    epochs=30,
    batch_size=8,
    lr=1e-4,
)
```

Thirty epochs on 1,341 images is roughly twenty minutes on Colab's free T4. Watch
the validation mAP; it should climb past 0.8 quickly on a single-class problem
this clean.

**3 — Export to ONNX.**

```python
model.export(format="onnx")     # writes inference_model.onnx
```

**4 — Send me the `.onnx` file.** Drop it next to the dataset. I check its size
and input shape, run it in the browser through `onnxruntime-web`, and measure it
against the same held-out `test` split the classical one was graded on — same
script, same IoU, so the comparison is like for like.

## 7. What to expect

The classical detector gets IoU ≥ 0.5 on 71% of still images and much less on
video. A fine-tuned detector on a clean single-class dataset typically lands
above 0.9 mAP, and — the part that matters — it holds on blurred frames, because
it never depended on edges.

If it does not beat the classical one on the same test split, it does not ship.
That rule has already killed two detectors in this project and it should kill a
third if the numbers say so.

---

## One thing worth checking before any of this

The symptom changed from "no answer" to "wrong answer", and a wrong answer has
two very different causes. The live view prints both numbers in its corner panel:

- **score around 0.6–0.75 with a wrong card** — the crop is wrong. That is the
  detector's problem and this document is the fix.
- **score above 0.9 with a wrong card** — the crop is fine and the card is not in
  the index, or the wrong catalogue is selected. No detector will fix that, and
  it would be an expensive way to find out.

One screenshot of that panel with a real card in frame separates them.
