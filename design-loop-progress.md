# Design loop — progress

Bar: [bar.md](bar.md) (099 SUPPLY, craft) · [design-system.md](design-system.md) (tokens) · functional reference: pokemonpricetracker.com (minus API monetization)

## Pieces

| # | Piece | Status | Round |
|---|---|---|---|
| 1 | Visual lift — existing pages (home, collections, product, price-checker, about) | ✅ won | 4 |
| 2 | New page — card value calculator (MVP shell) | ⏳ not started | — |
| 3 | New page — grading ROI calculator (MVP shell) | ⏳ not started | — |
| 4 | New page — collection portfolio tracker (MVP shell) | ⏳ not started | — |

## Piece 1 — round history

### Round 1
- Builder: ✅ done — globals.css tokens, Geist Mono everywhere, pill/8px radii, zero shadows (except one residual inline shadow found in price-chart tooltip during my own check), FireRed/Sapphire/Emerald triad wired. `tsc`/`build` both pass.
- Note: visual pixel screenshots unavailable this session (Browser pane not compositing) — critics are using computed-style extraction (`getComputedStyle`) + raw HTML checks instead, which is actually a more precise way to check bar.md's mechanisms since they were written as measurable facts, not impressions.
- Brief critic (Sonnet): ✅ PASS
- System critic (Haiku): ✅ PASS (couldn't reach the price-chart hover tooltip — 0 cards render locally without APITCG_API_KEY, so this pass has a coverage gap, not a confirmed clean bill on that element)
- Craft critic (Opus): ❌ FAIL — gap: two simultaneous section-heading sizes (24px vs 20px at ≥640px) between page-body H2s and the footer's H2, both weight 500/0.18em tracking. Root cause: `design-system.md`'s Section-label spec was a "20-26px" range instead of a fixed value — fixed to 26px.
- Round 1 verdict: **FAIL** (craft). Sent single gap back to builder.

### Round 2
- Builder: ✅ fix applied — all section H2/H3 headings (site-footer, home, price-checker, product) unified to fixed `text-[26px]`, no responsive breakpoint variation. `tsc`/`build` pass.
- Brief critic (Sonnet): ✅ PASS
- System critic (Haiku): ✅ PASS
- Craft critic (Opus): ❌ FAIL — gap: 9 distinct spacing values found (4-80px) vs. the reference's 2 tokens. Root cause: another spec-ambiguity — `design-system.md`'s spacing rule didn't distinguish rhythm (section/element gaps, bound to 80/12) from padding (page-shell/component interior, unbound). Clarified the spec, then sent the now-scoped gap back.
- Round 2 verdict: **FAIL** (craft). Sent single gap back to builder.

### Round 3
- Builder: ✅ fix applied — collapsed every stray rhythm value (4/8/16/20/24/32px) across home, about, collections, product, price-checker, header, footer to 80px/12px; padding left untouched. `tsc`/`build` pass.
- Brief critic (Sonnet): ✅ PASS
- System critic (Haiku): ❌ FAIL — gap: H1 measured 48px vs. design-system.md's bare "54px". Root cause: spec bug, not code — H1 has always been intentionally responsive (40/48/54px across breakpoints, verified identical on all 4 pages), different critics were sampling different viewports. Documented the real responsive scale in design-system.md instead of touching code.
- Craft critic (Opus): ❌ FAIL — gap: the "Check price" button renders at two sizes (12px/32px-tall on the full price-checker page vs. 12.8px/28px-tall on the footer widget) — same control, same role, `compact` prop swaps Button `size` between "default" and "sm". Real execution bug, sent to builder.
- Round 3 verdict: **FAIL** (system + craft, different causes — one spec fix, one real code gap).

### Round 4
- Builder: ✅ fix applied — `PriceCheckerForm`'s `compact` prop removed (its only effect was the button-size split); button now always `size="sm"` in both call sites. `tsc`/`build` pass.
- Brief critic (Sonnet): ✅ PASS (flagged a console `ReferenceError: compact is not defined` — investigated: raw `curl` post cache-wipe shows zero trace, source confirmed clean by direct read. False alarm from stale browser-tab console history, not a real defect. No action taken.)
- System critic (Haiku): ✅ PASS — button-size fix confirmed holding (12.8px/28px identical on both instances)
- Craft critic (Opus): ✅ PASS — all 3 prior fixes confirmed holding; noted (non-blocking) that the "Check price" button and brand/link text sit at off-scale 12.8px/14px, inherited rather than chosen from the type scale. Not a mechanism violation, carried forward as a nice-to-have.
- Round 4 verdict: **WIN** — all three critics pass. Piece 1 closed.

## Piece 1 — total: 4 rounds, 3 spec fixes (heading range → fixed 26px, spacing rhythm/padding split, H1 responsive-exception documented), 2 real code fixes (heading-size split, duplicate button size).

**Carried forward (non-blocking, optional):** unify the "Check price" button and brand/link text onto the documented type scale instead of inherited 12.8px/14px values.
