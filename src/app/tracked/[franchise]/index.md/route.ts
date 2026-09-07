import { collectionToMarkdown } from "@/lib/markdown";
import type { Franchise } from "@/lib/types";

const FRANCHISES: Franchise[] = ["pokemon", "one-piece"];

function isFranchise(value: string): value is Franchise {
  return FRANCHISES.includes(value as Franchise);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ franchise: string }> }
) {
  const { franchise } = await params;
  if (!isFranchise(franchise)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(await collectionToMarkdown(franchise), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
