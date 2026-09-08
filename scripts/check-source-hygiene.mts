#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * No control characters in source files.
 *
 * WHY THIS IS WORTH A CHECK. A `\b` written through a tooling layer that eats
 * one backslash becomes a literal BACKSPACE byte (0x08), and the result is a
 * regex that compiles, type-checks, lints clean, and matches nothing:
 *
 *   /\x08(?:VMAX|GX|EX|V)\x08/gi
 *
 * That shipped twice in one day — once as a word-boundary in a card-label
 * pattern that silently dropped every `ex` suffix, once in a catalogue key.
 * Nothing in the normal toolchain sees it, because a control character inside
 * a string literal is valid. It is invisible in a diff and in an editor.
 *
 * Tabs and newlines are ordinary; everything else in the C0 range is a mistake.
 *
 *   npx tsx scripts/check-source-hygiene.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["src", "scripts"];

/** Tab, newline and carriage return are legitimate; the rest of C0 is not. */
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

const offenders: string[] = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    if (!FORBIDDEN.test(source)) continue;
    source.split("\n").forEach((line, index) => {
      const match = FORBIDDEN.exec(line);
      if (!match) return;
      const code = line.charCodeAt(match.index).toString(16).padStart(2, "0");
      offenders.push(
        `${path.relative(process.cwd(), file)}:${index + 1}  U+00${code.toUpperCase()} at column ${match.index + 1}`
      );
    });
  }
}

if (offenders.length > 0) {
  console.error("[hygiene] control characters in source — almost certainly a swallowed escape:\n");
  for (const offender of offenders) console.error(`   ${offender}`);
  console.error("\n   A literal 0x08 is what `\b` becomes when a backslash is eaten. Rewrite the escape.");
  process.exit(1);
}

console.log("[hygiene] OK — no control characters in src/ or scripts/.");
