# KEYLINE — Design Direction

Working name. Rename in one place: `WORDMARK` in `public/index.html`.

**Reading this as:** a measurement console for a developer who holds a stack of API keys and needs to know which ones still work, in an instrument-panel visual language, dial ENERGY 2 / RHYTHM 2 / MOTION 1.

Dial: `ENERGY 2 / RHYTHM 2 / MOTION 1`

---

## The product, in one line

You paste a file of keys, name a base URL, and the tool tells you which keys answer, how fast, and how many tokens each one burned. Then you take the ones that passed.

That is a bench instrument. Not a landing page. Every screen is a readout or a control.

---

## Non-negotiable rules this file resolves

| Rule | Rule says | This design does | Where |
|---|---|---|---|
| R-02 / 9.G | Zero em dashes, no en dash separators | Every string uses hyphen, comma, colon, parentheses | all copy |
| R-01 | Gradients forbidden unless identity with a stated reason | Zero gradients, anywhere. Flat fills only, so contrast never varies across a surface | `--accent`, `--pass` etc. |
| R-04 + 9.E | Icons must be relevant; library-look icons and hand-rolled decorative SVG discouraged | Icons are hand-authored functional SVG, relevance listed below | icon table |
| R-06 | Do not use the model's default typeface picks | Archivo + IBM Plex Mono, reasons below | `--font-ui`, `--font-data` |
| R-07 | Grid / blueprint / dot backgrounds need a stated reason | No background pattern at all | body |
| R-11 | Radius variation is a hierarchy tool, no pill-everything | Three radii, assigned by role | radius tokens |
| R-12 | Shadow only as an elevation marker, reason required | Exactly one shadow: the sticky toolbar | `.bar` |
| R-13 | Glow allowed only as a focus accent | Zero glow | focus rings |
| R-21 / R-34 | Dev tools may justify a fixed theme; any shipped toggle must work in both modes | Both modes shipped and contrast-checked | theme tokens |
| R-25 | AA contrast minimum | Every pair computed below | contrast table |
| R-27 | Empty, loading and error states required | All three, on every data surface | state map |
| R-29 | 2-3 core colours plus 1 accent | Bone, graphite, rule plus one vermilion accent | palette |
| R-31 | One-line reason for every major decision | This document | here |
| R-35 | Click-through evidence required | Recorded in README | README |

**R-37 conflict protocol, noted override.** The brief explicitly asked for SVG icons. That collides with the 9.E default preference for a packaged icon library. The brief wins. Recorded here, not silently applied.

---

## Identity motif

**The ruled scale.** A 1px rule carrying tick marks sits under each primary numeric readout. It repeats in the parse summary, the run bar, and the model summary.

Reason: the product's whole job is measurement, and a ruled line is the universal shorthand for measurement. It also gives the interface one repeated gesture that belongs to this tool and nothing else. It is the licensed case under 9.F, because it organizes real numbers rather than decorating empty space.

Drawn as inline SVG, never as a CSS gradient.

---

## Palette

Core three: **bone** (ground), **graphite** (text), **rule** (structure). One accent: **vermilion signal**.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#F4F2ED` | `#131211` | page ground, warm bone |
| `--surface` | `#FFFFFF` | `#1B1A18` | panels |
| `--ink` | `#14130E` | `#EDEAE2` | primary text |
| `--ink-2` | `#5C594F` | `#9C978A` | secondary text |
| `--rule` | `#DCD8CE` | `#302E2A` | hairlines, borders |
| `--accent` | `#C0361A` | `#E8603C` | one accent: primary action, active tab, key figure |
| `--pass` | `#1F6B45` | `#4FBF8B` | status: key answered |
| `--warn` | `#8A5A0B` | `#D9A441` | status: rate limited, no quota |
| `--fail` | `#9E2B20` | `#E5766B` | status: rejected, error |

**Why bone and not white:** a pure white ground makes a console feel like a form. Warm bone reads as paper stock and lifts the mono figures off the page without needing a shadow.

**Why vermilion:** it is the lamp colour on bench equipment. It reads as a signal, not a brand mood. It is used only where something is actionable or measured, never as a decorative wash.

**Why no gradients:** the brief asked for none, and the rule agrees only when a gradient carries hierarchy that equals another scheme, which flat fills already do here. Flat also guarantees contrast is constant across every surface.

**Status colours are semantic, not the core palette** (R-29 note). They appear as text and a chip border, never as large fills.

### Contrast, computed

WCAG ratio, normal text needs 4.5:1.

| Pair | Ratio | Verdict |
|---|---|---|
| ink on bg, light | 15.4:1 | pass |
| ink-2 on bg, light | 6.28:1 | pass |
| accent on bg, light | 5.02:1 | pass |
| white on accent, light | 5.60:1 | pass |
| pass on bg, light | 5.79:1 | pass |
| warn on bg, light | 5.31:1 | pass |
| fail on bg, light | 6.68:1 | pass |
| ink on bg, dark | 15.8:1 | pass |
| ink-2 on bg, dark | 6.50:1 | pass |
| accent on bg, dark | 5.58:1 | pass |

---

## Typography

Two families. Both served from a font CDN with a system fallback, so the page still reads if the CDN is unreachable.

**Archivo** for interface and headings.

Reason: a grotesque with sturdy, squared terminals and tight sidebearings. It reads like signage stencilled on equipment, which is the material this app is imitating. It is not Inter, not Geist, not Space Grotesk, and not picked for being a model default.

**IBM Plex Mono** for every number, key string and field label.

Reason: drawn for technical interfaces and data readouts, and its figures are tabular, so measurement columns line up digit for digit. Chosen for scanning a column of latencies, not for terminal cosplay. A large mono headline is not used anywhere; mono only ever carries data.

**Scale.** 11px labels, 13px body, 14px table cells, 20px section titles, 30px figures. Display figures use tabular mono at weight 500 with slight negative tracking so long numbers stay compact. No oversized H1.

**Uppercase** is limited to 11px field labels with 0.06em tracking. It is not used for section headings.

---

## Layout

Grid: 12 columns, 1180px max, 20px gutters, 24px page padding on mobile.

Section order follows the work, not a template:

1. **Toolbar** (sticky). Wordmark, route status lamp, theme toggle.
2. **Keys.** Asymmetric 7/5 split. Left: the drop zone and paste area. Right: the parse readout.
3. **Endpoint.** Base URL, auth header, paths, route mode.
4. **Probe.** Concurrency, timeout, max tokens, repeats, model selection.
5. **Run.** Live counters and the progress rule.
6. **Results.** The core table. The one element that matters most on this screen.
7. **Per model.** Aggregate table plus trackless bars.
8. **Export.** Take N active keys, pick a format, copy or download.
9. **Footer.** One honesty line and the repo link.

**Why asymmetric rather than two even columns:** the drop zone and the readout are not equally important, and even columns would say they are. 7/5 states the rank.

**RHYTHM 2** shows up as: full-bleed table, inset panels, one wide bar. Section widths change. The internal pattern does not repeat identically six times.

### Radius

| Token | Value | Role |
|---|---|---|
| `--r-lg` | 14px | panels |
| `--r-md` | 8px | inputs, buttons, rows |
| `--r-sm` | 4px | chips, tags, status |

Reason: three steps make container, control and label legible at a glance. Nothing is a pill.

### Elevation

One shadow on the sticky toolbar only: `0 1px 0 var(--rule), 0 8px 24px -18px rgb(0 0 0 / .35)`.

Reason: the toolbar is the only surface that floats over content. Cards sit flat on the ground with a 1px rule, because a card that floats competes with the table.

---

## Icons

Hand-authored, 24 grid, 1.5 stroke, square caps and joins to echo the ruled motif. Every glyph names a real object on the screen.

| Icon | Meaning | Why it fits |
|---|---|---|
| key | a key record | literal |
| socket | base URL, the thing keys plug into | literal |
| stack | drop a key file | the file is a stack of lines |
| gauge | latency | bench instrument for time |
| pulse | throughput tok/s | a rate trace |
| coin stack | tokens | tokens are the currency here |
| cube | model | a model is a box you address |
| arrow to line | export | take out and land it |
| play, stop | start, halt the run | transport controls |
| sun, moon | theme | literal |
| copy | copy to clipboard | literal |
| download | download a file | literal |
| chevron | expand a row | literal |
| close | clear a field | literal |

No sparkle, star, bolt, orb or robot. No icon is used twice for two meanings.

---

## Motion

**MOTION 1.** Hover, focus and pressed states. The progress rule advances while a run is live, because that motion is the status. Nothing animates in on scroll, nothing parallaxes, no element fades up. `prefers-reduced-motion: reduce` removes every transition.

Reason: a measurement readout that moves while you read it is a readout you cannot trust.

---

## States

| Surface | Empty | Loading | Error |
|---|---|---|---|
| Keys | "No keys loaded. Drop a .txt, .md, .json or .csv, or paste them." | parse spinner on the button | malformed lines counted and listed |
| Models | "Fetch models to pick targets." | button busy, list skeleton | upstream message shown verbatim |
| Run | "Idle. 0 of N probed." | live counters and rule | per key error text in the row |
| Results | "No rows yet." | first rows stream in | row shows status and message |
| Export | "No passing keys yet." | not applicable | "Format needs at least 1 passing key" |

Every one of these is implemented, not described.

---

## Honesty rules this UI obeys

- Tokens are read from the upstream `usage` field. If upstream returns none, the cell shows `n/a`. Nothing is estimated from character counts.
- The timing breakdown shows server measured time and client round trip side by side, so the network overhead is visible instead of hidden inside one number.
- Quota is shown only when an endpoint actually reports it. Otherwise `n/a`.
- No performance claim is printed anywhere unless the app measured it in that session.

Reason: R-17 and R-36. A measuring tool that invents numbers is worse than no tool.
