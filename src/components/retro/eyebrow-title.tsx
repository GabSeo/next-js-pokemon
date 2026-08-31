/**
 * The label that heads every block in the Grading Center: a small hard-bordered
 * square in the block's own accent colour, then the title in tracked-out
 * uppercase.
 *
 * One component rather than the same three classes copied into four files, so
 * the squares stay the same size and the tracking stays the same width. The
 * colour is the only thing that varies, and it is a key: red for the grade
 * ladder, blue for the market comparison, yellow for the verdict.
 */
export function EyebrowTitle({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "red" | "blue" | "yellow" | "ink";
}) {
  const fill =
    tone === "red"
      ? "bg-pokemon-red"
      : tone === "blue"
        ? "bg-pokemon-blue"
        : tone === "yellow"
          ? "bg-pokemon-yellow"
          : "bg-foreground";

  return (
    <span className="flex items-center gap-2 text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">
      <span className={`h-2.5 w-2.5 flex-none border-2 border-black ${fill}`} />
      {children}
    </span>
  );
}
