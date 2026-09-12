#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * How far ahead is the right card, once the printed number has narrowed the field?
 *
 * THE QUESTION THIS ANSWERS. A printed number names several cards — 154 of 216
 * English sets share their total — and the artwork then orders them. If the
 * winner stands far enough clear of the runner-up, showing the runner-up at all
 * is noise. This measures how far, on real photographs, so the threshold is
 * fitted rather than guessed.
 *
 *   npx tsx scripts/tiebreak-lab.mts "<folder>" [--index en]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { clipIndexFrom, CLIP_DIM } from "../src/lib/clip-search";
import { lookupCards } from "../src/lib/card-lookup";

const target = process.argv[2];
const which = process.argv.includes("--index") ? process.argv[process.argv.indexOf("--index") + 1] : "en";
const CAT = path.join(process.cwd(), "data", "catalog", "pokemon-clip");
const m = JSON.parse(readFileSync(path.join(CAT, `${which}.json`), "utf8")) as { ids: string[] };
const buf = readFileSync(path.join(CAT, `${which}.i8`));
const copy = new ArrayBuffer(buf.length);
new Uint8Array(copy).set(buf);
const index = clipIndexFrom(m, copy);
const at = new Map(m.ids.map((id, i) => [id, i]));

const { AutoModel, Tensor, env } = await import("@huggingface/transformers");
env.allowLocalModels = false;
const vision = await AutoModel.from_pretrained("Xenova/mobileclip_s2", { dtype: "fp16", model_file_name: "vision_model" });

async function embed(file: string, fill: number): Promise<Float32Array> {
  const img = sharp(readFileSync(file));
  const meta = await img.metadata();
  const W = meta.width!, H = meta.height!, ar = 300 / 420;
  const h = Math.min(H * fill, (W * fill) / ar), w = h * ar;
  const base = fill >= 1 ? img : img.extract({ left: Math.round((W - w) / 2), top: Math.round((H - h) / 2), width: Math.round(w), height: Math.round(h) });
  const { data } = await base.removeAlpha().resize(256, 256, { fit: "fill", kernel: "cubic" }).raw().toBuffer({ resolveWithObject: true });
  const px = new Float32Array(3 * 256 * 256);
  for (let i = 0; i < 256 * 256; i++) for (let c = 0; c < 3; c++) px[c * 256 * 256 + i] = data[i * 3 + c] / 255;
  const out = await (vision as never as (x: unknown) => Promise<{ image_embeds: { data: Float32Array } }>)({ pixel_values: new Tensor("float32", px, [1, 3, 256, 256]) });
  const r = out.image_embeds.data;
  let n = 0; for (const v of r) n += v * v; n = Math.sqrt(n) || 1;
  const q = new Float32Array(CLIP_DIM);
  for (let i = 0; i < CLIP_DIM; i++) q[i] = r[i] / n;
  return q;
}

const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(target, f))
  : [target];

const gaps: { file: string; gap: number; right: boolean; n: number }[] = [];

for (const file of files) {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  const printed = /(?:^|[\s_-])([A-Za-z]{0,4})[\s_-]?(\d{1,3})[\s_-](\d{1,3})$/.exec(base);
  if (!printed) continue;
  const [, prefix, number, total] = printed;
  const matches = lookupCards(`${prefix}${number}/${prefix}${total}`, "pokemon").matches;
  if (matches.length < 2) {
    console.log(`${base.slice(0, 34).padEnd(35)} ${matches.length} candidat — rien a departager`);
    continue;
  }

  // The card the filename names, by the words before the number.
  const words = base.slice(0, printed.index).toLowerCase().replace(/[^a-z]+/g, "");
  const want = (matches.find((x: { name?: string; code: string }) =>
    String(x.name).toLowerCase().replace(/[^a-z]+/g, "").includes(words.slice(0, 12))) ?? matches[0]).code;

  const q = await embed(file, 0.82);
  const scored = matches
    .map((x: { code: string; name?: string }) => {
      const i = at.get(x.code);
      // A card the index does not hold has no score, and a sentinel of -1 would
      // report a gap of 1.79 on a scale where 0.2 is decisive. Dropped instead.
      if (i === undefined) return undefined;
      let s = 0; for (let k = 0; k < CLIP_DIM; k++) s += index.vectors[i * CLIP_DIM + k] * q[k];
      return { code: x.code, name: String(x.name), score: s / 127 };
    })
    .filter((x): x is { code: string; name: string; score: number } => x !== undefined)
    .sort((a, b) => b.score - a.score);

  if (scored.length < 2) {
    console.log(`${base.slice(0, 34).padEnd(35)} ${matches.length} candidats, un seul indexe`);
    continue;
  }
  const gap = scored[0].score - scored[1].score;
  const right = scored[0].code === want;
  gaps.push({ file: base, gap, right, n: matches.length });
  console.log(
    `${base.slice(0, 34).padEnd(35)} ${matches.length} candidats  ecart ${gap.toFixed(4)}  ` +
      `1er ${scored[0].code.padEnd(12)} ${right ? "✓" : `✗ (attendu ${want})`}`
  );
}

const ok = gaps.filter((g) => g.right);
const bad = gaps.filter((g) => !g.right);
console.log(`\n${gaps.length} photos avec plusieurs candidats — ${ok.length} bien classees en premier`);
if (ok.length) console.log(`  ecart quand c'est JUSTE : min ${Math.min(...ok.map((g) => g.gap)).toFixed(4)}  median ${ok.map((g) => g.gap).sort((a, b) => a - b)[ok.length >> 1].toFixed(4)}`);
if (bad.length) console.log(`  ecart quand c'est FAUX  : max ${Math.max(...bad.map((g) => g.gap)).toFixed(4)}`);
