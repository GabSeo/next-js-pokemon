import Link from "next/link";

type ComingSoonProps = {
  eyebrow: string;
  title: string;
  description: string;
  /** What this tool will actually need once it's real, stated plainly rather than hidden. */
  dataNote: string;
};

/**
 * Minimal shell for a mockup tool card that doesn't have a built page yet —
 * "set the base" pages per the visual-uplift scope: real navigation target,
 * real MintDex styling, honest about not being wired to live data. Every
 * word here is real static HTML — nothing is JS-gated.
 */
export function ComingSoon({ eyebrow, title, description, dataNote }: ComingSoonProps) {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-24 text-center">
      <span className="mb-2 inline-block text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">
        {eyebrow}
      </span>
      <h1 className="mb-4 text-[32px] leading-tight font-black tracking-[-1px] sm:text-[40px]">{title}</h1>
      <p className="mb-8 text-base leading-6 text-muted-text">{description}</p>
      <div className="mb-8 rounded-lg border-2 border-black bg-muted-surface p-6 text-left text-sm leading-6 text-muted-text shadow-hard-sm">
        <strong className="text-foreground">Not connected yet:</strong> {dataNote}
      </div>
      <Link
        href="/tools/price-checker"
        className="inline-block rounded-md border-2 border-black bg-foreground px-6 py-3 text-sm font-black text-white shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md active:translate-x-0 active:translate-y-0 active:shadow-none"
      >
        Try the price checker instead
      </Link>
    </div>
  );
}
