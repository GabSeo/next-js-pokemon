import { fetchCardImage } from "@/lib/pokewallet";

/**
 * Proxies PokéWallet's `/images/:id` — see pokewallet.ts's fetchCardImage
 * doc comment for why: that endpoint requires an `X-API-Key` header a
 * browser `<img src>` can't send. Same shape as
 * app/api/berrywallet-image/[id]/route.ts, its One Piece counterpart.
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
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
