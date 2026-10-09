# UI design system

The HTML UI and the in-world overlays share one look: warm ink on dark metal, Barlow Semi Condensed for words and IBM Plex Mono for numbers.

A design system has three layers. Principles say what the UI is for and how to judge it. Patterns say how a kind of problem is solved every time, like a shop row, a disabled button or an alert. Tokens and shared pieces say what it is built from. A person or an agent who builds a new screen follows all three, so it makes the same choices as the screens before it.

Open <http://localhost:5173/ui.html> with `npm run dev` to see every token and shared piece drawn with the real CSS.

## 1. What the UI is for

The source is DESIGN.md: the game shows what the player needs to decide and hides what they should discover. Every rule below comes from that sentence or from another line of DESIGN.md.

The UI serves decisions, not data. A screen exists because the player makes a choice there. A fact is on screen because that choice needs it.

## 2. Principles

Each principle has a reason from the game and a test you can run on a screenshot.

P1. Start from the decision. Before a screen gets a layout, write the question the player answers there and the facts that answer it. Test: every element on the screen answers that question or helps act on it.

P2. Key facts are never one step away. A fact the player needs to choose now is visible without a hover, a click or a scroll. Test: cover every tooltip and closed panel, and the choice can still be made.

P3. The world is the main screen. Most choices happen with the cursor on the map: where to drive, who that is, whether to fight. So the card under the cursor is the most important panel in the game, and the HUD stays at the edges. Test: the center of the screen is free during planning.

P4. State on the HUD, events in the log. A state stays visible while it is true. An event is told once, in order. Test: nothing the player must track lives only in the log, and the log holds no mechanical state.

P5. Every number can explain itself. DESIGN.md says chances are shown with their causes. The cause lives on the number: hovering the number opens it in the shared tooltip, and a dotted underline marks a number that has one. The cause is reference, so it is not repeated in the glance view. The same holds for a price the player cannot pay, a button that does not work and a stat that will change. Test: hovering any chance shows its cause, and no disabled control lacks a reason.

P6. Show what the truck knows, no more. Information is a resource. The UI shows a fact with the certainty the player has. A vague contact looks vague and an unknown driver looks unknown. A fact a perk reveals is absent without the perk. It is not a locked slot, because DESIGN.md says no hand-holding and a slot is a hint. Test: no screen shows a value the player's truck could not know.

P7. Show it, don't say it. A drawing, an icon or a position carries meaning on its own. A word never repeats it, and a detail never repeats its row. Test: delete each label in turn and ask whether anything was lost.

P8. One thing, one look. The same fact kind prints the same way on every screen. The same state looks the same on every control. One icon means one concept. Test: money, condition and selection look identical in the shop, the inventory and the HUD.

P9. Planned and committed look different. Planning is free and a turn is a commitment. The player must always see which marks are still a plan. Test: a screenshot taken mid-plan and one taken mid-turn are easy to tell apart.

P10. Two voices, never mixed. Radio talk, dialogue and story lines are in character and never say turn, tier or quest. Labels, buttons, tooltips and tips are game chrome and may. Test: every text channel has one voice.

P11. Restraint. Color, size and weight carry meaning, so each is used for one job. One emphasis at a time: a word is bright or bold, never both. Decoration never uses a meaning color. A fact is said in color once: a hostile tag and a red relation line are two reds for one fact. Labels never use the accent, so the accent always means the player's choice. Emphasis follows the value, not the slot: values of one kind share one size, a high value is brighter and a zero is faint. A panel uses at most four text roles: title, body, caption and value. Test: on a grayscale screenshot the hierarchy still reads, and in color every colored thing means something.

P12. Space follows structure. A fact gets room in proportion to its importance. Related things sit tight, and groups are separated by space, not by lines or headings. A label that a unit, an icon or a position already makes clear is dropped, and a phrase that every row shares is said once. A panel that cannot scroll grows sideways before it grows down. A fact sits next to the thing it describes. Test: the panel has no divider lines and no empty block larger than the facts beside it.

P13. Everything sits on a grid. A panel has a head row and one or two columns below it. A column that holds a drawing has a fixed width. The column edges never depend on content, so the same panel has the same edges for every truck, part or place. Every left edge sits on a column line. Every number and every tag ends on the right edge. Side by side columns start on the same row. Vertical space has two steps only: tight within a group and wide between groups. Test: draw the column lines over a screenshot, and every element starts or ends on one.

P14. One kind of panel, one size. A panel's width, height and drawing box are set by its kind, never by its content. The size is set for the largest content it must hold, and smaller content leaves space at the end of a group, not between groups. Controls keep a fixed place, such as the bottom of their column. Test: two instances of the same panel with different content have the same outline.

P15. Separate lists that mean different things. Two lists the player must not confuse each sit in their own well. The well edge and the value ink carry whose list it is, such as a danger edge for the guns aimed at the player. Test: at a glance, without reading the heads, the player can tell which list is which.

P16. A tooltip is a small panel. It follows every rule above: text roles, grid, one name per concept and value-driven emphasis. It opens on the thing it explains, so it never repeats that value or restates what the panel around it already says. Its body is label and value rows, with labels in the UI face and values right aligned in mono. A breakdown speaks in the unit of the number it explains. It starts with Base and then adds one cause per row, so the rows add up to the number on screen. An internal unit, such as degrees of scatter, never reaches the player. The sim gives the steps, as `chanceSteps()` does for hit chances, and the UI only prints them. Base is muted ink, a step that lowers the number is in danger ink and a step that raises it is in good ink. A tooltip is as wide as its content, and it opens over the part of its panel that is not needed while it is open, never over a value the player is comparing. Words match the panel it opens from, so a cause called far on the card is never called range in the tooltip. Raw engine terms and debug strings never appear. Test: every number in the tooltip is in a unit the player already sees elsewhere, and the tooltip uses the same word as the card for each cause.

P17. Never narrate the screen. Text is allowed only when it adds a fact the screen does not already show. A word never restates a number, whose number it is, or which way it points, when position, color, grouping or the element the cursor is on already says it. A heading never names what its content plainly is. This is DESIGN.md's no hand-holding, applied to every label. Test: delete the text. If the player can still answer the same question from the screen, the text was hand-holding and stays deleted.

P18. The world is the most precious space. Every pixel a panel covers hides the desert, the trucks and the road. A panel takes the smallest area its content needs. It sits at the screen edge, never in the middle of play, and it opens only while it is needed. Transient overlays such as tooltips fit their content and never cover a value the player is comparing. A wider or taller panel needs a reason in the decision it serves. Test: in a field screenshot with every always-on panel shown, the center of the screen is clear, and no panel has an empty block wider than its content column.

P19. Controls are physical things. The truck's own controls look like hardware in a cab: toggle switches, knobs, keys and LCD displays like an old Casio. A setting that stays on is a switch, a level is a knob, and a readout of the truck is a display. A flat button is for a one-time action, like Buy or End turn, and for screens that are not part of the truck, like the menu. A new truck control picks the nearest existing piece in `drawings.css` before it gets a new look. Test: every control on the truck's HUD looks like something you could touch in a cab.

## 3. Information tiers

Every fact on a screen belongs to one tier for the decision that screen serves. The tier decides where the fact goes, how big it is and when it shows. The same fact can be key on one screen and supporting on another. Price is key in the shop and absent on the map.

| Tier | What it is | When it shows | How it looks |
| --- | --- | --- | --- |
| Key | Needed to choose now | Always, at every density | Value role, full ink, first after the name |
| Supporting | Helps compare or confirm | In the same view, at row and card density | Body or caption role, muted ink, after the key facts |
| Reference | Explains a rule, a cause in depth or the lore | On hover, on open or in help | Tooltip, open detail or the help panel |
| Ambient | Mood with no decision | Any time | The radio, flavor text, the world itself |

- A key fact never lives only in a tooltip, only in color or only in the log.
- A screen shows at most a few key facts. When everything looks key, nothing is. If a screen has more, split the decision or move facts down a tier.
- Supporting facts sit after the key facts in reading order and are visibly quieter.
- Reference text is never needed to act. If the player has to read a tooltip to choose, that fact is key and moves up.
- Ambient elements never carry a fact the player must act on.
- Moving down a tier is how a screen gets simpler. Deleting a fact is better still.

## 4. Where things go

### 4.1 Placement rules

- A thing in the world is labeled in the world.
- The state of my own truck lives in the HUD.
- A comparison between my truck and another lives on the cursor card.
- An explanation sits next to the number it explains, inside the same block.
- An action sits at the end of the line it changes. A Buy button is inside its row. The turn commits at the bottom right.
- A choice the game waits for opens a notice at the top center and stops nothing else on screen.
- A task that takes the whole attention, like a shop or a save, opens a modal in the center.

### 4.2 Zones

The screen has fixed zones. Each zone has one job, and an element never moves between zones. A new element goes in the zone whose job it shares. If none fits, the element is probably not always-on and belongs in a panel the player opens.

| Zone | Job | Lives there |
| --- | --- | --- |
| Top left | System | Feedback button |
| Top center | Transient and waiting | Action bar at the edge, toast below it, then notices and tips |
| Top right | System, then the cursor card | Menu and camera switch at the edge, the hover card below them |
| Right side | Ambient and waiting on | Radio, then contracts |
| Bottom right | Events and commit | Log above End turn |
| Bottom left | My truck | Truck diagram above the instruments and the weapons bar |
| Center | Task | Modals, dialogue, save and new game |

Two zones may never cover each other. A new element that needs room takes it from its own zone.

### 4.3 The always-on budget

The always-on HUD answers a short list of questions without a click: can I keep going, is my truck okay, what is around me, what will this turn do, what just happened and what am I waiting on. A new always-on element names the question it answers. If it answers none, it goes in a panel.

## 5. Entity anatomy

Parts, trucks, drivers, goods, contracts and places appear on many screens. Each has three densities with fixed slots in a fixed order: identity, then state, then key numbers, then cost, then action.

| Density | Use | Shows |
| --- | --- | --- |
| chip | Inside a sentence, a list of many, a slot | Identity only: icon and name |
| row | A list the player compares | Identity, key facts, cost, action |
| card | One thing the player studies | Everything key and supporting, reference on hover |

- A slot keeps its place at every density. A density drops slots from the end, never reorders them.
- A missing or unknown value keeps its slot empty or marked unknown. The layout never shifts.
- Numbers right align in fixed width columns in the mono face, so a list reads down a column.
- The open detail of a row adds facts. It never repeats one.

## 6. Interaction states

One grammar for every control and every selectable thing.

| State | Meaning | Look |
| --- | --- | --- |
| rest | Can be used | Surface and line tokens |
| hover | Under the cursor | Hover line and hover surface. Only things that react to a click change on hover. |
| focus | Keyboard focus | One accent outline everywhere |
| selected | The player's current choice | Accent border and accent wash |
| planned | A choice that is not committed yet | Dashed accent outline |
| working | Timed work in progress | Accent progress meter |
| disabled | Cannot be used now | Dimmed, with its reason |
| unaffordable | Needs more money | Price in danger ink |
| locked | Needs progress, like a rank | Lock icon |

- A control uses only the states in this table.
- A disabled control still takes hover and focus, so its reason can show. It uses `aria-disabled` and the shared tooltip, and the reason is one short fact like Need 12 M more.
- Unaffordable and locked look different, because the player fixes one by earning and the other by progressing.
- A click target is at least the small button height, 24px. Drawn hardware is exempt, such as the aim cells on a truck drawing, which keep the size of the drawing.

## 7. Feedback and alerts

Every event gets a level before it gets a channel. A level fires on its channels and on no others.

| Level | Meaning | Channels |
| --- | --- | --- |
| info | Worth a record | Log line |
| notable | Worth a glance now | Log line and toast |
| attention | A state the player must watch | A mark on the HUD that stays while true, and one log line when it starts |
| choice | The game waits for the player | A notice with its buttons |
| critical | The run changes | Full screen |

- A state alert lives on the HUD for as long as it is true. The log only records that it started.
- A notice always has the controls to answer it. A notice with nothing to press is not a choice and drops a level.
- Sound follows the level, and every sound follows `docs/sound.md`.

## 8. Words and numbers

- A unit is written once per value and in one style. Money is whole M. Fuel is L. Mass is kg. Speed is km/h. Work and cooldowns are in turns. Deadlines are game hours.
- Each fact kind has one formatter in `src/ui/format.ts` or `src/ui/units.ts`, and every screen calls it.
- A number that the player's choice will change shows its after value before the choice, like the truck's mass before a buy.
- A label is a noun. A button is a verb. A reason is a short fact.
- Every UI word costs. Use the fewest words that stay clear, such as You and Them for the two gun lists.
- No arrow characters as connectors in UI text, such as You → it. Name the thing in words. An arrow is allowed only as the name of an arrow key.
- A tip says one thing to do in one sentence.

## 9. Visual language

| Channel | One job |
| --- | --- |
| Accent mustard | Selection, focus, progress and the player's choice |
| Danger | Loss, hostility and failure |
| Good | Gain, health and success |
| Ink levels | Text hierarchy only, never a state |
| Size | Tier: key facts larger than supporting ones |
| Weight | Names and titles only |
| Dashed line | Provisional: a plan, or knowledge that is not exact |
| Flood fill | The thing under the cursor or selected, never a whole diagram |

World colors keep their meaning in the 3D view. The UI does not reuse the cold cyan of dead ship tech or the green glow of the reactor.

## 10. Where styles live

- `src/ui/tokens.css` holds every raw value: colors, fonts, type sizes, spacing, radii, shadows, layers and UI sizes. It is the only file that writes one.
- `src/ui/style.css` imports the tokens, then the files under `src/ui/styles/`. Its import order is the cascade.
- `src/ui/styles/components.css` holds the shared pieces below. Each other file under `styles/` holds one screen area and adds only its own layout.
- `src/ui/styles/drawings.css` holds drawn hardware: the switch, the speed dial, the radio knobs and keys. Its shapes keep their own sizes, and its colors still come from tokens.
- `src/ui/tokens.ts` reads `tokens.css` for Three.js. `tokenColor("--path-plan")` gives a color number and throws on an unknown name.
- `src/ui/style-guard.test.ts` fails on a raw value outside `tokens.css`. It reads every file under `styles/`, `truck-condition.css`, the HTML page and the inline styles of the UI and overlay scripts.

## 11. Tokens

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

## 12. Shared pieces

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

## 13. How to build a screen

1. Write the decision as one question.
2. List the facts that answer it. Give each a tier.
3. Pick the zone or the surface: in the world, HUD zone, cursor card, notice or modal.
4. Pick the density for each entity and fill its slots in order.
5. Use the shared formatters, states and pieces. Put the screen's rules in one file under `src/ui/styles/` and import it in `style.css` after `components.css`. Write only layout there. A new shared piece goes in `components.css`, this guide and `ui.html`.
6. Take every value from a token. Run `npx vitest run src/ui/style-guard.test.ts`.
7. Pick a level for every event the screen raises.
8. Take a screenshot next to a neighboring screen and check it against the principle tests.

### Worked example: the truck hover card

1. Decision: fight, talk or leave, and if I fight, where do I aim.
2. Key facts: who it is and its stance, my chance on it, its chance on me, and the drawing for aiming. Supporting facts: truck type, faction, motion, activity and states. Reference: the causes of each chance, in the tooltip on the chance. Distance is left out, because it changes no choice here and range already shows in the chances and their causes.
3. Surface: the cursor card, in the right column. It has the radio's width and right edge, and fills the space between the system row and the radio with one HUD gap to each.
4. Grid: the head row holds the name, the truck type and faction in muted ink, and the stance tag at the right edge. The state line under it starts with Parked or Moving and the speed, then the activity and the states. Below, the drawing takes the left 3/5 and the two lists the right 2/5.
5. Lists: the drawing is the main content, so it takes the wide column. The chances are supporting, so they take the narrow one. You sits in a well with a neutral edge, and Them in a well with a danger edge. One line per gun: your key for the gun, the gun's name in caption size, then the chance. A long name ends in "…" and shows in full on hover.
6. Color: hostility only in the tag. Chances by value: 50% and up brighter, 0% faint, the enemy's in danger ink. Healthy parts stay neutral, and only damage takes color.
7. Type: four roles. Title for the name, body for words, caption for list heads, keys and gun names, mono for chances.
8. Tooltip: hovering a chance opens Base, then one row per cause in percent, so the rows add up to the chance. It opens over the drawing, never over the lists.
