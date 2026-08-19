import type { Metadata } from "next";
import Link from "next/link";
import { entityMapDocument } from "@/lib/entitymap";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Entity map",
  description: `Which entities ${SITE_NAME} covers, how they relate, and where the evidence for each one lives.`,
  alternates: { canonical: "/entitymap" },
};

const PREDICATE_LABEL: Record<string, string> = {
  COVERS: "covers",
  TRACKED_BY: "tracked by",
  PART_OF: "part of",
};

export default async function EntityMapPage() {
  const doc = await entityMapDocument();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Entity map</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Where <code className="rounded bg-muted px-1 py-0.5 text-xs">sitemap.xml</code> tells crawlers which pages
        exist, this tells AI systems what {SITE_NAME} actually knows: which entities it covers, how they relate,
        and which pages carry the evidence for each one.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Machine-readable:{" "}
        <a href="/entitymap.json" className="underline underline-offset-4 hover:text-foreground">
          /entitymap.json
        </a>{" "}
        · EntityMap v{doc.version}, <code>{doc.profile}</code> profile ·{" "}
        <a href="https://entitymap.org" className="underline underline-offset-4 hover:text-foreground">
          spec
        </a>
      </p>

      <div className="mt-8 space-y-6">
        {doc.entities.map((entity) => (
          <div key={entity.entityId} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold">{entity.name}</h2>
              <span className="text-xs text-muted-foreground">{entity["@type"]}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{entity.description}</p>

            {entity.sameAs && (
              <p className="mt-2 text-xs">
                <span className="text-muted-foreground">Same as: </span>
                <a href={entity.sameAs} className="underline underline-offset-4 hover:text-foreground">
                  {entity.sameAs}
                </a>
              </p>
            )}

            {entity.relations && entity.relations.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {entity.relations.map((rel) => (
                  <li key={`${rel.predicate}-${rel.targetId}`}>
                    {PREDICATE_LABEL[rel.predicate] ?? rel.predicate.toLowerCase()} <strong className="text-foreground">{rel.targetName}</strong>
                  </li>
                ))}
              </ul>
            )}

            {entity.hasChunks && entity.hasChunks.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <h3 className="text-xs font-medium text-muted-foreground">Evidence</h3>
                <ul className="mt-1 space-y-1">
                  {entity.hasChunks.map((chunk) => (
                    <li key={chunk.chunkId} className="text-xs">
                      <Link href={new URL(chunk.sourceUrl).pathname} className="underline underline-offset-4 hover:text-foreground">
                        {chunk.pageTitle}
                      </Link>
                      <span className="text-muted-foreground"> — {chunk.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
