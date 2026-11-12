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
| `danger-solid` / `danger-solid-hover` | `#D00000` / `#A80000` | Solid red fill with Cream 10 text: the customer's cancel button (`Button variant="dangerSolid"`) |
| `danger-bright` / `danger-bright-hover` | `#F25C5C` / `#E04444` | Bright red fill with Cocoa 100 text: confirm buttons of destructive admin actions on blue modals (`variant="dangerBright"`) |

Contrast ratios (WCAG): `fg` on `page` 12.3:1 · `muted` on `page` 4.7:1 and on `surface` 6.3:1 · `ink` on gold 6.9:1 · cream on blue 11.4:1 · `ink` on `field` 13:1 · `field-muted` on `field` 5.2:1.
A blue fill differs from the dark surfaces by hue only, which is why selected items also get the light `selected-line` border.
The two solid reds sit outside the Figma ramps: `danger` is a light tone made for text on dark backgrounds, so it can't carry a filled button.

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

- **Header nav link (current page)**: `border border-accent text-accent` on a transparent background (gold outline), with `border-transparent` on the other links
- **Selected item** (movie date strip, admin queue list, admin seat-layout editor): `border border-selected-line bg-selected text-on-selected`. Give unselected siblings `border border-transparent` so nothing shifts when the selection moves. Pages drawn from the newer wireframes override it: the admin sidebar uses `border-cream-70 bg-cream-80 text-cream-10`, the time slots in the showtime form use `bg-cocoa-100 text-cream-10` on their cream panel, and the customer seat map uses green (see Seat map)
- **Tabs**: `components/ui/Tabs.jsx` (cream track, blue selected tab by default). `activeClassName` changes the selected tab: My bookings uses `bg-cocoa-100 text-cream-20`; the refunds and reports pages use `bg-cocoa-100 text-cream-10` on a `border border-gold-50 bg-gold-20` track (`className`)
- **Status**: `StatusBadge` (pill with a dot) for booking, payment and movie statuses; its `tone` prop forces a tone, as on a cancelled booking card (red "cancelled", plus a green "refunded" badge once the money is back). `Chip` for short labels (`tone="accent"` is the gold info chip, the other tones are status colors)
- **Showtime info chips** (theatre, date, time): outlined gold spans, `rounded-md border border-accent px-1.5 py-0.5 text-accent`, on the booking card, seat selection, change seats and the admin payment and refund panels. The payment summary and the movie detail page still use `Chip tone="accent"`
- **Card**: `.card` (surface with a `card-line` border). Cards that are links or buttons add `hover:border-accent`. Booking cards, the PromptPay panel, the payment status cards and the account forms use a dark gold-bordered card instead: `rounded-xl border border-gold-40 bg-cocoa-100`
- **Inputs**: `Input`, `Select`, `Textarea`, `PasswordInput` (all `.input-base`). They are cream with a light `color-scheme`, so date pickers and select arrows stay visible. Icons placed on an input use `text-field-muted`
- **Gold forms**: the login, register, forgot/reset password and profile cards restyle the inputs inside them from the card itself: `[&_.input-base]:border-gold-50 [&_.input-base]:bg-gold-20 [&_.text-muted]:text-cream-30 [&_label>span:first-child]:text-body-1 [&_label>span:first-child]:text-fg!`. The admin modal forms (movie, theatre, showtime, user) use only the gold input border and the label part. Inputs elsewhere stay cream
- **Buttons**: `Button` — `primary` is gold with `ink` text, `secondary` is outlined with `line-strong`, `ghost` highlights with `bg-fg/8` so it works on any surface. `navy` (Blue 90 with a gold border) is for secondary actions on the payment and account pages (save QR, send slip, save); `cream` (Cream 30 with a gold border, dark text) opens tickets and receipts; `dangerSolid` and `dangerBright` use the solid reds above
- **Pagination**: the current page is gold (`border-accent bg-accent text-cocoa-100`); other pages and the arrows are `border-cocoa-80 bg-cocoa-100 text-cream-10`
- **Select menu** (`SelectMenu`): a cream list (`bg-cream-30`, `border-gold-50`, dark text); the selected option is `bg-cocoa-100 text-cream-10` and the keyboard/hover option `bg-cream-40`
- **Modal**: the `.theme-blue` panel has a `border-gold-40` frame; the sticky header is `bg-blue-100/95` with a `border-gold-50` divider; the footer has no divider
- **Seat map** (customer, `SeatMap`): available seats are filled blue by zone (`zoneFill` in `components/seatmap/zoneRing.js`: Normal Blue 40, Premium Blue 60, Sofa Blue 100, Cream 10 numbers). Selected seats are a green outline (`border-2 border-success`, slightly scaled up). On the change-seats page, the customer's original seats that aren't selected are dashed green (`border-dashed border-success bg-success/15`), the same tone as selected seats. Taken seats are `bg-danger/70` with an X. The legend has no separate "available" swatch, because the zone swatches are the available colors. The admin seat-layout editor still uses the `zoneRing` borders with blue selected seats, so no zone ring uses blue
- **Logo**: `client/public/logo.png`, used in the header and the receipt header (each beside the brand name), in the E-Ticket and as the favicon. Beside the name it has `alt=""`, so screen readers don't read the name twice
- **Icons**: decorative icons (section headers, empty states) are gold; small icons inside a line of text take the text color
- **Brand icons** (the social links on the contact page, `text-gold-50`): `components/ui/SocialIcons.jsx` draws them as inline SVG, because lucide has no LINE, TikTok or X mark and has deprecated its other brand icons. The f, Instagram and YouTube shapes come from lucide (ISC), the LINE, TikTok and X marks from Simple Icons (CC0)
- **E-Ticket** (`TicketPage`): one ticket per seat. A navy frame (`bg-blue-80`) with gold top and bottom bars (`border-y-8 border-gold-50`) and a "Ticket" label holds the logo in a paper circle that overlaps the top edge of an inner `.theme-paper` card. The card shows the QR (140px, level H), a light-blue theatre and seat box (`bg-blue-20` with a `border-blue-70` border), the movie, then date, time, amount paid and payment reference. The seat arrows are gold chevrons beside the ticket from `sm` up, and below it on phones. The ref is on the navy frame, so the saved PNG is the whole ticket, drawn on a page-color margin (`utils/saveImage.js`)

## Rules

- Components use semantic tokens. Palette utilities are for roles the tokens don't cover
- No hex colors in JSX, and no Tailwind default color or size utilities
- Every state change must be visible: outlines of controls and selected items reach at least 3:1 against their background
- The email templates (`server/src/CineBook.Web/Emails/`) can't use the CSS tokens, so they repeat the palette values inline; keep them in step

## Changing the design system

1. Change the token in `client/src/index.css`, and in `.theme-blue` / `.theme-paper` if the role exists there
2. Update this page
3. Run `cd client && npm run build`, then check the affected pages in Thai and English, at phone width and on desktop ([Checking the web app in a browser](testing.md#checking-the-web-app-in-a-browser))
