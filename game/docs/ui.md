# UI design system

The HTML UI and the in-world overlays share one look: warm ink on dark metal, Barlow Semi Condensed for words and IBM Plex Mono for numbers. This guide says where each value lives and which shared piece to use, so a new screen looks like the old ones.

Open <http://localhost:5173/ui.html> with `npm run dev` to see every token and shared piece drawn with the real CSS.

## Where styles live

- `src/ui/tokens.css` holds every raw value: colors, fonts, type sizes, spacing, radii, shadows, layers and UI sizes. It is the only file that writes one.
- `src/ui/style.css` imports the tokens, then the files under `src/ui/styles/`. Its import order is the cascade.
- `src/ui/styles/components.css` holds the shared pieces below. Each other file under `styles/` holds one screen area and adds only its own layout.
- `src/ui/styles/drawings.css` holds drawn hardware: the switch, the speed dial, the radio knobs and keys. Its shapes keep their own sizes, and its colors still come from tokens.
- `src/ui/tokens.ts` reads `tokens.css` for Three.js. `tokenColor("--path-plan")` gives a color number and throws on an unknown name.
- `src/ui/style-guard.test.ts` fails on a raw value outside `tokens.css`. It reads every file under `styles/`, `truck-condition.css`, the HTML page and the inline styles of the UI and overlay scripts.

## Tokens

Name a token by its role, like `--ink-muted` or `--panel-l`, never by its value. Use the nearest token. When a value falls halfway between two steps, take the smaller one. Add a token only when two or more places need a value no token gives.

- Type: `--font-ui` for words and `--font-mono` for numbers, clocks and readouts. Six sizes only: `--text-caption` 10px, `--text-dense` 12px, `--text-body` 14px, `--text-lead` 16px, `--text-heading` 24px and `--text-hero` 40px. HUD panels and data use `--text-dense`. Modals and dialogs use `--text-body`. A new size needs the user's approval.
- Surfaces from dark to light: `--surface-sunk` for wells and tracks, `--surface-well` for inputs, chips and tiles, `--surface-dock` for the right dock, `--surface-panel` for panels and dialogs, `--surface-highlight` for a hovered row, `--surface-raised` for buttons and notices, `--surface-hover` for a hovered button. Overlays over the 3D view use `--surface-overlay`.
- Lines from faint to bright: `--line-faint` between rows, `--line-soft` around chips and tiles, `--line` around small controls, `--line-strong` for the edge of a panel and a button, `--line-bright` for the frame of a dialog or notice. `--line-hover` edges a hovered control.
- Text: `--ink` by default, `--ink-bright` above it, `--ink-title` for headings, `--ink-label` for table heads and small labels, `--ink-muted` for secondary text, `--ink-faint` for an option that is off. `--ink-overlay` is the text over the 3D view. `--ink-on-accent` is text on an accent fill.
- Accent marks selection, focus, progress and the player's choice: `--accent`, `--accent-bright`, `--accent-warm`, `--accent-dim` for utilities, `--accent-deep`, and `--accent-wash` for a light fill.
- Danger marks loss, hostility and failure: `--danger`, `--danger-bright`, `--danger-ink` for text, `--danger-deep`, `--danger-dark` and the `--danger-well` fills. `--alarm` is the part that is about to break.
- Good marks gain, health and success: `--good`, `--good-bright`, `--good-deep` and `--good-well` for a meter track.
- The condition ramp `--cond-pristine` to `--cond-junk` colors part condition and must fall in brightness. A test checks it.
- `--cell-*` colors the truck grid in the inventory and `--map-*` the small grid on truck cards.
- `--path-*` colors the path preview on the ground through `tokenColor()`.
- `--steel-0` to `--steel-11`, `--lcd-*` and `--dial-*` color the drawn hardware only.
- Spacing steps run `--space-1` 2px to `--space-10` 32px. Padding, margin and gap use them. A 1px hairline and 0 stay raw.
- `--radius-s` and `--radius-m` round corners. A circle stays `50%`.
- `--icon-xs` 12px to `--icon-hero` 56px size icon boxes. `--meter-s`, `--meter-m` and `--meter-l` set bar heights, and `--pip` sets a rank pip or a footprint cell.
- Panel widths are `--panel-s` 260px, `--panel-m` 300px, `--panel-l` 420px and `--panel-xl` 520px. `--dock-width` is the right dock, and it narrows on small windows. `--modal-width` and `--modal-height` cap a modal.
- HUD placement: `--hud-inset` from the window edge, `--hud-gap` between HUD panels, `--hud-hover-top` for the hover panel and `--hud-notice-top` for notices.
- Layers run `--z-hud` to `--z-crash`. A new layer goes between two others in `tokens.css`, never as a raw number.

## Shared pieces

Use a shared piece before writing a new rule. A screen may add its own layout to a piece, but not its own colors, type or frame.

- `.panel` is the base of every HUD box: panel surface, strong edge, shadow and the standard padding of `--space-4` by `--space-5`. The radio, the instruments and the weapons are drawn hardware and use the compact padding of `--space-2` by `--space-4`. Only the help panel sets its own, since its rows carry their own margins.
- `.dialog` frames a modal, the save panel and the New game screen, with the scrim over the game and padding of `--space-9` on every side.
- `.dock-panel` is a panel of the right dock: the log, the contracts and the radio.
- `.notice` is a box at the top middle of the HUD that waits for a choice: rescue, stranded and dialogue.
- `.panel-title` is the heading of a small HUD panel. A dialog uses a plain `h3`.
- A text button has one of three heights: `--btn-h-s` 24px, `--btn-h-m` 32px and `--btn-h-l` 44px. A plain `button` is medium. `.btn-s` makes a small one for rows, cards, table cells and small panels. `.btn-l` makes a large one for a screen's main choice. `.btn-danger` marks a hostile action. `.on` marks a pressed toggle.
- Only `components.css` sets a button's height, padding or type size. A screen file places a button and sets its width. The small group of buttons that size themselves are tiles and drawn hardware, and the list is in `components.css`. A new button joins a size, and the guard test fails when a screen file sizes one.
- `.tabs` is a row of medium tab buttons, and `.tabs.sub` the small row inside a tab.
- `.row` is a list line with a faint line under it. `.tile` is a boxed list item edged in its `--tone`.
- `.chip` is a small boxed value. `.tag` is an outlined word in the color of its text.
- `.meter` is a bar that fills from the left. `.s` and `.l` change its height. `.broken` turns the track to danger. `.progress` fills it with the accent for timed work and recharge.
- `.tooltip` is a note that opens over its anchor.
- `.num` is a number in the mono face. `.dim`, `.good` and `.bad` color a word.

## Words

- Every UI word costs. Use the fewest words that stay clear, such as You and Them for the two gun lists.
- No arrow characters as connectors in UI text, such as You → it. Name the thing in words, such as You and Them. An arrow is allowed only as the name of an arrow key.

## New screen checklist

- Put the screen's rules in one file under `src/ui/styles/` and import it in `style.css` after `components.css`.
- Build the frame from a shared piece. Write only layout in the screen file.
- Take every value from a token. Run `npx vitest run src/ui/style-guard.test.ts`.
- Add any new shared piece to `components.css`, this guide and `ui.html`.
- Take a screenshot and compare it with a neighboring screen.
