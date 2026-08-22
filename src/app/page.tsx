import Link from "next/link";
import type { Metadata } from "next";
import { PsaTiltCard } from "@/components/retro/psa-tilt-card";
import { CardImage } from "@/components/card-image";
import { OpenDataLinks } from "@/components/open-data-links";
import { StructuredData } from "@/components/structured-data";
import { getAllCards } from "@/lib/cards";
import { cardRefs } from "@/data/card-refs";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `${SITE_NAME} — Pokémon & One Piece card prices`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/", types: { "text/markdown": "/index.md" } },
};

// 36 hours (must be a literal — Next.js statically parses this export).
export const revalidate = 129600;

type ToolEntry = {
  href: string;
  icon: string;
  title: string;
  body: string;
  fill: "on-white" | "on-red" | "on-blue" | "on-yellow";
  badge?: string;
};

const TOOL_CATEGORIES: { title: string; tag: string; tools: ToolEntry[] }[] = [
  {
    title: "Track & Value",
    tag: "The daily driver",
    tools: [
      {
        href: "/tools/price-checker",
        icon: "🔍",
        title: "Price Checker",
        body: "Search and check current Pokémon card prices, updated every day.",
        fill: "on-red",
        badge: "Live",
      },
      {
        href: "/tools/price-guides",
        icon: "📖",
        title: "Price Guides",
        body: "Complete price guides for every Pokémon set, from Base to the latest drop.",
        fill: "on-white",
      },
      {
        href: "/collections/pokemon",
        icon: "🗂️",
        title: "Browse Sets",
        body: "Explore every Pokémon TCG set and every card that lives inside it.",
        fill: "on-white",
      },
      {
        href: "/collection",
        icon: "❤️",
        title: "My Collection",
        body: "Track what you own and watch your collection's value grow in real time.",
        fill: "on-yellow",
      },
    ],
  },
  {
    title: "Invest Smarter",
    tag: "For the spreadsheet crowd",
    tools: [
      {
        href: "/tools/set-ev-calculator",
        icon: "🧮",
        title: "Set EV Calculator",
        body: "Crunch the expected value of a booster box before you rip a single pack.",
        fill: "on-blue",
      },
      {
        href: "/tools/sealed-products",
        icon: "📦",
        title: "Sealed Products",
        body: "Track booster box, ETB, and sealed product prices over time.",
        fill: "on-white",
      },
      {
        href: "/tools/market-movers",
        icon: "📈",
        title: "Market Movers",
        body: "See which cards are trending and which prices just spiked or dipped.",
        fill: "on-white",
        badge: "Hot",
      },
    ],
  },
  {
    title: "Grade with Confidence",
    tag: "Before you send it in",
    tools: [
      {
        href: "/tools/psa-analysis",
        icon: "🏅",
        title: "PSA Analysis",
        body: "Analyze PSA graded card values, population data, and ROI.",
        fill: "on-white",
      },
      {
        href: "/tools/grading-calculator",
        icon: "🎯",
        title: "Grading Calculator",
        body: "Find out if grading your card is actually worth the fee.",
        fill: "on-red",
      },
      {
        href: "/tools/when-to-grade",
        icon: "🛡️",
        title: "When to Grade",
        body: "Learn the market signals that tell you grading makes sense.",
        fill: "on-white",
      },
      {
        href: "/tools/psa-vs-bgs-vs-cgc",
        icon: "📊",
        title: "PSA vs BGS vs CGC",
        body: "Compare pricing, turnaround, and premiums across grading companies.",
        fill: "on-yellow",
      },
    ],
  },
];

const FILL_CLASSES: Record<string, string> = {
  "on-white": "bg-card-surface text-foreground",
  "on-red": "bg-pokemon-red text-white",
  "on-blue": "bg-pokemon-blue text-white",
  "on-yellow": "bg-pokemon-yellow text-foreground",
};

const FILL_BODY_CLASSES: Record<string, string> = {
  "on-white": "text-muted-text",
  "on-red": "text-white/85",
  "on-blue": "text-white/85",
  "on-yellow": "text-[#3a3a00]",
};

// Placeholder rows for the MVP shell — not wired to live data yet (see
// design-loop-progress.md / chat history: visual uplift ships first,
// TCGGO-backed real "market movers" ranking comes once that API is wired
// into cards.ts). Every number here is illustrative, not fetched.
const MARKET_MOVERS = [
  { name: "Charizard ex", set: "Obsidian Flames · #125", price: "$89.40", change: "+12.4%", up: true },
  { name: "Umbreon VMAX Alt Art", set: "Evolving Skies · #215", price: "$412.00", change: "+7.8%", up: true },
  { name: "Base Set Blastoise Holo", set: "Base Set · #2", price: "$210.00", change: "+2.1%", up: true },
  { name: "Pikachu VMAX", set: "Vivid Voltage · #44", price: "$34.10", change: "-4.2%", up: false },
  { name: "Rayquaza VMAX Alt Art", set: "Evolving Skies · #218", price: "$156.00", change: "-1.5%", up: false },
] as const;

export default async function HomePage() {
  const cards = await getAllCards();
  const heroCard = cards.find((c) => c.franchise === "pokemon") ?? cards[0];

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: SITE_DESCRIPTION,
  };

  return (
    <div>
      <StructuredData data={websiteJsonLd} />

      <header className="relative overflow-hidden border-b-2 border-black bg-[radial-gradient(var(--color-border-subtle)_1.5px,transparent_1.5px)] bg-[length:18px_18px] py-20">
        <div className="relative z-[2] mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-16 px-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border-2 border-black bg-pokemon-yellow px-3.5 py-1.5 text-xs font-black tracking-[0.6px] uppercase shadow-hard-sm">
              🔥 Trending: {heroCard ? `${heroCard.name} — ${cardRefs.length} cards tracked` : "New cards added weekly"}
            </div>
            <h1 className="mb-5 text-[40px] leading-[42px] font-bold tracking-[-1.5px] sm:text-[56px] sm:leading-[58px]">
              Gotta track
              <br />
              <span className="text-pokemon-red" style={{ WebkitTextStroke: "1px #000" }}>
                every price.
              </span>
            </h1>
            <p className="mb-10 max-w-[480px] text-lg leading-7 text-muted-text">
              {SITE_NAME} catalogs Pokémon and One Piece trading cards with live market pricing — the price
              tracker for collectors who treat their binder like a balance sheet.
            </p>

            <form
              role="search"
              action="/tools/price-checker"
              method="GET"
              className="mb-6 flex max-w-[480px] items-center gap-3 rounded-lg border-2 border-black bg-card-surface py-3 pr-3 pl-5 shadow-hard-lg"
            >
              <span aria-hidden="true">🔍</span>
              <label htmlFor="hero-cardId" className="sr-only">
                Card ID
              </label>
              <input
                id="hero-cardId"
                name="cardId"
                type="text"
                placeholder="Search a card ID, e.g. gengar-vmax-271…"
                className="min-w-0 flex-1 border-none text-base text-foreground outline-none placeholder:text-[#9a9a9a]"
              />
              <button
                type="submit"
                className="rounded-md border-2 border-black bg-foreground px-4.5 py-2.5 text-sm font-black whitespace-nowrap text-white shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md active:translate-x-0 active:translate-y-0 active:shadow-none"
              >
                Check Price
              </button>
            </form>
            <div className="flex flex-wrap gap-3 text-xs text-muted-text">
              {cardRefs.slice(0, 4).map((ref) => (
                <Link
                  key={ref.slug}
                  href={`/tools/price-checker?cardId=${ref.slug}`}
                  className="rounded-full border-2 border-black bg-muted-surface px-2.5 py-1 font-bold hover:bg-white"
                >
                  {ref.displayName}
                </Link>
              ))}
            </div>
            <OpenDataLinks markdownHref="/index.md" jsonHref="/api/site" okfHref="/okf/home" className="mt-8" />
          </div>

          <div className="relative z-[2] flex flex-col items-center gap-3">
            {heroCard ? (
              <PsaTiltCard>
                <CardImage card={heroCard} className="aspect-[300/420] w-full" priority />
              </PsaTiltCard>
            ) : (
              <div className="flex aspect-[300/420] w-full max-w-[300px] items-center justify-center rounded-[14px] border-2 border-black bg-muted-surface text-sm text-muted-text shadow-hard-lg">
                Card art loads once pricing data is available.
              </div>
            )}
            <div className="rounded-full border-2 border-black bg-card-surface px-3.5 py-1.5 text-xs font-black tracking-[0.25px] uppercase shadow-hard-sm">
              This is what a <b className="text-success-green">Gem Mint 10</b> looks like
            </div>
          </div>
        </div>
      </header>

      <section className="relative z-[2] border-b-2 border-black bg-card-surface">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-6 px-6 py-6 text-center sm:grid-cols-4">
          <div>
            <div className="text-[32px] font-black tracking-[-0.6px]">{cardRefs.length}</div>
            <div className="mt-1 text-xs font-bold tracking-[0.6px] text-muted-text uppercase">Cards Tracked</div>
          </div>
          <div>
            <div className="text-[32px] font-black tracking-[-0.6px]">36h</div>
            <div className="mt-1 text-xs font-bold tracking-[0.6px] text-muted-text uppercase">Price Refresh Window</div>
          </div>
          <div>
            <div className="text-[32px] font-black tracking-[-0.6px]">2</div>
            <div className="mt-1 text-xs font-bold tracking-[0.6px] text-muted-text uppercase">Franchises Tracked</div>
          </div>
          <div>
            <div className="text-[32px] font-black tracking-[-0.6px]">3</div>
            <div className="mt-1 text-xs font-bold tracking-[0.6px] text-muted-text uppercase">Data Formats / Card</div>
          </div>
        </div>
      </section>

      <section className="relative z-[2] px-6 py-24" id="tools">
        <div className="mx-auto max-w-[1180px]">
          <div className="mx-auto mb-12 max-w-[640px] text-center">
            <span className="mb-1 inline-block text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">
              Everything in one binder
            </span>
            <h2 className="mb-3 text-[32px] leading-tight font-black tracking-[-1px] sm:text-[40px]">
              Built for people who take this seriously.
            </h2>
            <p className="text-base leading-6 text-muted-text">
              Whether you&rsquo;re chasing a PSA 10 or building a spreadsheet of your entire collection,{" "}
              {SITE_NAME} has the tool for it.
            </p>
          </div>

          {TOOL_CATEGORIES.map((category, i) => (
            <div key={category.title} className={i > 0 ? "mt-16" : ""}>
              <div className="mb-6 flex items-baseline gap-3">
                <h3 className="text-2xl font-black tracking-[-0.6px]">{category.title}</h3>
                <span className="border-l-2 border-border-subtle pl-3 text-xs font-bold tracking-[0.6px] text-muted-text uppercase">
                  {category.tag}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {category.tools.map((tool) => (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className={`group relative min-h-[170px] overflow-hidden rounded-lg border-2 border-black p-6 shadow-hard-md transition-[transform,box-shadow] duration-150 ease-out hover:-translate-x-[3px] hover:-translate-y-[3px] hover:shadow-hard-xl active:translate-x-0 active:translate-y-0 active:shadow-hard-sm ${FILL_CLASSES[tool.fill]}`}
                  >
                    {tool.badge && (
                      <span className="absolute top-3 right-3 rounded-full border-2 border-black bg-success-green px-2 py-0.5 text-[10px] font-black tracking-[0.25px] text-white uppercase">
                        {tool.badge}
                      </span>
                    )}
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-md border-2 border-black bg-white text-xl">
                      {tool.icon}
                    </div>
                    <h4 className="mb-1 text-lg font-black tracking-[-0.45px]">{tool.title}</h4>
                    <p className={`text-sm leading-5 ${FILL_BODY_CLASSES[tool.fill]}`}>{tool.body}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-[2] px-6 pb-24" id="movers">
        <div className="mx-auto max-w-[1180px]">
          <div className="mx-auto mb-12 max-w-[640px] text-center">
            <span className="mb-1 inline-block text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">
              Illustrative — not live yet
            </span>
            <h2 className="mb-3 text-[32px] leading-tight font-black tracking-[-1px] sm:text-[40px]">
              The market moves. So do we.
            </h2>
            <p className="text-base leading-6 text-muted-text">
              A snapshot of what climbing-and-cooling coverage will look like once cross-catalog trend ranking
              ships.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border-2 border-black shadow-hard-lg">
            <div className="flex items-center justify-between border-b-2 border-black bg-muted-surface px-6 py-5">
              <h3 className="text-lg font-black tracking-[-0.45px]">🔥 Market Movers</h3>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-text">
                <i className="inline-block h-2 w-2 animate-pulse rounded-full bg-success-green" aria-hidden="true" />
                Sample data
              </span>
            </div>
            {MARKET_MOVERS.map((row, i) => (
              <div
                key={row.name}
                className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 bg-card-surface px-6 py-5 ${i > 0 ? "border-t-2 border-border-subtle" : ""}`}
              >
                <div className="h-[60px] w-11 rounded-sm border-2 border-black bg-gradient-to-br from-pokemon-yellow to-pokemon-red" />
                <div>
                  <div className="text-[15px] font-black">{row.name}</div>
                  <div className="text-xs font-bold text-muted-text">{row.set}</div>
                </div>
                <div className="text-right text-base font-black tabular-nums">{row.price}</div>
                <div
                  className={`min-w-[74px] rounded-full border-2 border-black px-2.5 py-1 text-center text-[13px] font-black tabular-nums text-white ${row.up ? "bg-success-green" : "bg-pokemon-red"}`}
                >
                  {row.up ? "▲" : "▼"} {row.change}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-[2] border-t-2 border-b-2 border-black bg-[var(--color-nav-dark)] bg-[radial-gradient(rgba(255,255,255,0.08)_1.5px,transparent_1.5px)] bg-[length:16px_16px] py-20 text-center text-white">
        <div className="mx-auto max-w-[1180px] px-6">
          <h2 className="mb-3 text-[32px] font-black tracking-[-1px] sm:text-[40px]">
            Every price, readable by humans and agents.
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-base text-white/65">
            Every page ships as HTML, Markdown, and JSON from the same data — no separate API tier required to
            read it.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/collections/pokemon"
              className="rounded-md border-2 border-black bg-pokemon-red px-6.5 py-3.5 text-[15px] font-black text-white shadow-[4px_4px_0px_0px_rgba(255,255,255,0.9)] transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.9)] active:translate-x-0 active:translate-y-0 active:shadow-none"
            >
              Browse Pokémon Cards
            </Link>
            <Link
              href="/llms.txt"
              className="rounded-md border-2 border-white px-6.5 py-3.5 text-[15px] font-black text-white"
            >
              See the Agent Index
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
