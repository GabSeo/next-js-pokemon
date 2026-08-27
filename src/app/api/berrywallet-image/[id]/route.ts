import { fetchCardImage } from "@/lib/berrywallet";

/**
 * Proxies BerryWallet's `/images/:id` — see berrywallet.ts's fetchCardImage
 * doc comment for why this has to exist at all: that endpoint requires an
 * `X-API-Key` header a browser `<img src>` can't send, unlike every other
 * image source in this codebase (TCGdex, apitcg), which are plain
 * unauthenticated CDN links. This route holds the key server-side and
 * forwards the already-long-cached bytes through.
 *
 * Dynamic, not statically generated: card ids aren't known at build time
 * for a source not yet wired into cards.ts/generateStaticParams — once it
 * is, this can be revisited the way /api/pokemon/[id] pre-builds by id.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const size = new URL(request.url).searchParams.get("size") === "low" ? "low" : "high";
  const image = await fetchCardImage(id, size);

  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(image.body, {
    headers: {
      "Content-Type": image.contentType,
      // BerryWallet's own CDN already sends this — mirrored here rather
      // than trusted implicitly, so this route's own contract is explicit
      // regardless of what upstream happens to send on any given request.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
