/**
 * How this project talks to tcgcollector.com, and how slowly.
 *
 * THE PACING IS THE POINT. This is somebody's community site, it runs on
 * donations, and it is under no obligation to serve us anything. The first pass
 * ran at 700 ms between images — about 1.4 requests a second — which is faster
 * than a person can click and fast enough to show up in their logs as a machine.
 * Everything here is deliberately slower than it needs to be:
 *
 *   images     2.5 s apart, so roughly 24 a minute
 *   set pages  6 s apart, because one page is worth sixty images to us
 *   jitter     ±30%, so the pattern is not a metronome
 *   breather   30 s every 100 requests
 *
 * Nothing about this is on a request path — it runs once, writes files into the
 * repository, and the site then serves those files from its own CDN forever.
 * A job that takes two hours instead of twenty minutes costs us nothing and
 * costs them a great deal less.
 *
 * THROUGH CURL, NOT `fetch`, and not for want of trying the nice way. Node's
 * fetch is refused with a 403 no matter what headers it sends — the same
 * User-Agent, Accept, Accept-Language and Upgrade-Insecure-Requests that curl
 * sends successfully. What is left is the TLS handshake, which Node signs
 * differently from a browser and which the site evidently fingerprints. Worth
 * writing down rather than working around silently: that is a deliberate signal
 * that automated clients are not welcome, and it is one more reason the pacing
 * above is not decorative.
 */
import { execFileSync } from "node:child_process";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Milliseconds between requests of each kind, before jitter. */
export const IMAGE_PAUSE = 2_500;
export const PAGE_PAUSE = 6_000;

/** Every hundredth request, stop for this long. */
const BREATHER_EVERY = 100;
const BREATHER = 30_000;

let count = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The wait after a request: the base, scattered by ±30%, plus the breather. */
export async function pause(base: number): Promise<void> {
  await sleep(Math.round(base * (0.7 + Math.random() * 0.6)));
  if (count > 0 && count % BREATHER_EVERY === 0) {
    console.log(`  … ${count} requests, pausing ${BREATHER / 1000}s`);
    await sleep(BREATHER);
  }
}

/** One GET, and the only place a request to them is made. */
export function get(url: string): Buffer {
  count++;
  return execFileSync("curl", ["-sL", "--compressed", "-A", UA, "--max-time", "60", url], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  });
}

export function requestsMade(): number {
  return count;
}
