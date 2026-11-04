# Design system

The web app's colors, type and the rules for using them.
Everything is defined as Tailwind theme tokens in [`client/src/index.css`](../client/src/index.css); components use those tokens and nothing else.

## Contents

- [Principles](#principles)
- [Color](#color)
- [Typography](#typography)
- [Component recipes](#component-recipes)
- [Rules](#rules)
- [Changing the design system](#changing-the-design-system)

---

## Principles

- **Dark theme only.** 27 of 30 surveyed users chose dark mode: it feels like being in a cinema and makes posters stand out.
  The one exception is *paper*: the E-Ticket and the receipt are light, so QR codes scan reliably and print the way they look on screen
- **60 · 30 · 10**
  - 60% Cocoa 90: the page background
  - 30% Cocoa 100: header, sidebar and cards; Cream: inputs, tab bars and checkboxes
  - 10% Gold: primary buttons, card borders, chips and icons; Blue: modals, the user button and selected items
- **Only design-system values exist.** Tailwind's default colors and font sizes are switched off (`--color-*: initial`, `--text-*: initial`), so `bg-red-500` or `text-lg` produce no CSS.
  Tailwind skips unknown classes without an error, so a typo shows up on the page, not in the build

## Color

### Palette

Four ramps from Figma, from 10 (lightest) to 100 (darkest). The base color of each ramp is in bold.

| Step | Cocoa | Blue | Gold | Cream |
|---|---|---|---|---|
| 10 | `#E8E8E7` | `#E8EBEF` | `#FFFAF2` | `#FFFEFC` |
| 20 | `#D1D1D0` | `#D1D7DF` | `#FFECCC` | `#FFF6E8` |
| 30 | `#BABAB9` | `#A3AFC0` | `#FFDDA6` | **`#E8DFCF`** |
| 40 | `#A4A3A2` | `#7587A1` | `#FFCF80` | `#D1C8B7` |
| 50 | `#8D8C8B` | `#465E82` | `#E5B76B` | `#BBB1A0` |
| 60 | `#767573` | `#2F4B72` | **`#C89D56`** | `#A49A8A` |
| 70 | `#605E5C` | **`#193763`** | `#AB8443` | `#8D8474` |
| 80 | `#494745` | `#163159` | `#8E6B33` | `#776E5F` |
| 90 | `#32302E` | `#142C4F` | `#715424` | `#60594B` |
| 100 | **`#1C1A17`** | `#112645` | `#533D18` | `#494338` |

Utilities follow the names: `bg-cocoa-90`, `text-gold-60`, `border-blue-30`.
Use them directly only for one-off roles the semantic tokens don't cover (the blue user button).

> Figma labels Cream 60 as `#A49A88`, but the fill used in the file is `#A49A8A`. The code uses the fill.

### Status colors

| Tone | Text | Background | Used for |
|---|---|---|---|
| `success` | `#86D7A8` | `#16301F` | Paid, approved, refunded, now showing |
| `warning` | `#FF9B5C` | `#3A2111` | Awaiting payment, slip or refund; notices that need action |
| `danger` | `#FF9D92` | `#3D1915` | Rejected, errors, taken seats |
| `info` | `#9CC4FF` | `#112645` | Awaiting slip review, coming soon |

The pattern is `border-<tone>/30 bg-<tone>-bg text-<tone>`, as in `StatusBadge`, `Chip` and the toasts.

### Semantic tokens

| Token | Value | Role |
|---|---|---|
| `page` | Cocoa 90 | Page background (the 60%) |
| `surface` | Cocoa 100 | Header, sidebar, cards, footer, bottom bar |
| `surface-2` | Cocoa 90 | Things nested inside a surface: secondary buttons, time slots, available seats, inner panels |
| `ink` | Cocoa 100 | Text on gold or on a status fill; the modal overlay |
| `line` | Cocoa 80 | Dividers and table borders |
| `line-strong` | Cocoa 70 | Outlines of controls that must be visible on the page background |
| `card-line` | Gold 90 | Card border at rest; clickable cards add `hover:border-accent` |
| `fg` / `muted` | Cream 20 / Cream 60 | Body text / secondary text |
| `accent` / `accent-dark` | Gold 60 / Gold 70 | Primary buttons, chips, icons, focus ring / hover state, gold on paper |
| `selected` / `selected-line` / `on-selected` | Blue 70 / Blue 30 / Cream 20 | Selected items |
| `field` / `field-line` / `field-muted` | Cream 30 / Cream 40 / Cream 90 | Inputs, tab bars and checkboxes / their border / icons and inactive tabs on cream |
| `paper` | Cream 10 | Light document surfaces (E-Ticket, receipt, QR frames) |

Contrast ratios (WCAG): `fg` on `page` 12.3:1 · `muted` on `page` 4.7:1 and on `surface` 6.3:1 · `ink` on gold 6.9:1 · cream on blue 11.4:1 · `ink` on `field` 13:1 · `field-muted` on `field` 5.2:1.
A blue fill differs from the dark surfaces by hue only, which is why selected items also get the light `selected-line` border.

### Scopes

Two classes re-point the semantic tokens for everything inside them, so components nested in a modal or a ticket need no special cases:

| Class | Applied to | What changes |
|---|---|---|
| `.theme-blue` | Every `Modal` panel | `surface` Blue 70, `surface-2` Blue 80, `line` Blue 50, `line-strong` Blue 40, `muted` Blue 30, `card-line` Blue 50. Selected items become Blue 20 with Blue 100 text, because dark blue would vanish on the blue panel |
| `.theme-paper` | E-Ticket and receipt | Light `color-scheme`, `surface` paper, `surface-2` Cream 20, `fg` Cocoa 100, `muted` Cocoa 70, `line` Cocoa 10, `line-strong` Cocoa 20, and `danger` switches to its dark tone (the refund stamp) |

A scope must redeclare every token it changes, because tokens that reference other tokens are resolved at `:root`.
For the same reason the theme is not `inline`: utilities have to read `var(--color-…)` on the element where they are used.

## Typography

### Fonts

| Font | Utility | Used for |
|---|---|---|
| Inter | `font-sans` (default) | Latin text and numbers |
| Noto Sans Thai | `font-sans` (default) | All Thai UI text |
| Cinzel | `font-brand` | The brand name in both languages; `h1` and `h2` when the UI is in English |
| Sarabun | `font-description` | Movie synopsis and details |
| Inter with tabular, slashed-zero digits | `font-code` | Booking codes, payment references, receipt and account numbers |

- `font-sans` lists Inter first and Noto Sans Thai second. Inter has no Thai glyphs, so the browser uses Inter for Latin letters and digits and Noto Sans Thai for Thai, which is the split the design system asks for, with no per-language classes. `font-description` does the same with Sarabun
- `h1` and `h2` use `--font-heading`, which is `font-sans` and switches to Cinzel under `:root:lang(en)` (`I18nContext` keeps `<html lang>` in sync). Cinzel has no Thai glyphs, so it is never used for Thai text
- The fonts load from Google Fonts in `client/index.html`, only in the weights the design system uses. Google Fonts splits files by character range, so the Thai files download only when Thai text is on screen
- The stylesheet `<link>` has `crossorigin`. Without it the browser hides the stylesheet's `@font-face` rules from scripts, and the E-Ticket image saved by "Save e-ticket" falls back to system fonts

### Type scale

| Utility | Size / line height | Weights | Typical use |
|---|---|---|---|
| `text-h1` | 32 / 40 | 400–700 | Page titles, headline numbers |
| `text-h2` | 20 / 28 | 400–700 | Section, modal and card titles |
| `text-body-1` | 16 / 24 | 400–700 | Body text (the default) and inputs |
| `text-body-2` | 14 / 20 | 400–700 | Secondary text, buttons, labels, tables |
| `text-caption` | 12 / 18 | 400–500 only | Badges, captions, table headers |

- Every `h1` is `text-h1`; long movie titles step down on phones (`text-h2 sm:text-h1`). Every `h2` is `text-h2`
- Responsive pairs stay inside the scale, for example `text-body-2 sm:text-body-1`
- Don't override the line height of text with `leading-*`: the scale's line heights leave room for Thai vowels and tone marks
- There is no `font-black`, because weight 900 isn't loaded

## Component recipes

- **Selected item** (nav link, admin menu, date strip, time slot, seat): `border border-selected-line bg-selected text-on-selected`. Give unselected siblings `border border-transparent` so nothing shifts when the selection moves
- **Tabs**: `components/ui/Tabs.jsx` (cream track, blue selected tab)
- **Status**: `StatusBadge` (pill with a dot) for booking, payment and movie statuses; `Chip` for short labels (`tone="accent"` is the gold info chip, the other tones are status colors)
- **Card**: `.card` (surface with a `card-line` border). Cards that are links or buttons add `hover:border-accent`
- **Inputs**: `Input`, `Select`, `Textarea`, `PasswordInput` (all `.input-base`). They are cream with a light `color-scheme`, so date pickers and select arrows stay visible. Icons placed on an input use `text-field-muted`
- **Buttons**: `Button` — `primary` is gold with `ink` text, `secondary` is outlined with `line-strong`, `ghost` highlights with `bg-fg/8` so it works on any surface
- **Seat map**: selected seats are blue; the zone rings come from `components/seatmap/zoneRing.js`, and no zone uses blue
- **Icons**: decorative icons (section headers, empty states) are gold; small icons inside a line of text take the text color
- **E-Ticket** (`TicketPage`): one `.theme-paper` card per seat, in three rows: QR, stub (theatre and seat), movie. The stub's notches are `bg-page` circles that the card's `overflow-hidden` cuts in half, so they read as holes. The card is a `grid-rows-subgrid` of the page grid, which puts the seat arrows beside the card in the stub's row: they line up with the notches at any stub height, and they sit outside the paper scope, so they use the dark-theme tokens. The saved PNG is framed in the page color, so the rounded corners and notches blend into the frame

## Rules

- Components use semantic tokens. Palette utilities are for roles the tokens don't cover
- No hex colors in JSX, and no Tailwind default color or size utilities
- Every state change must be visible: outlines of controls and selected items reach at least 3:1 against their background
- The email templates (`server/src/emails/`) can't use the CSS tokens, so they repeat the palette values inline; keep them in step

## Changing the design system

1. Change the token in `client/src/index.css`, and in `.theme-blue` / `.theme-paper` if the role exists there
2. Update this page
3. Run `cd client && npm run build`, then check the affected pages in Thai and English, at phone width and on desktop ([Checking the web app in a browser](testing.md#checking-the-web-app-in-a-browser))
