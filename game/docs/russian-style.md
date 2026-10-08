# Russian copy

How to write the Russian text in `src/text/ru/`. Read it before you add or change a Russian entry. [Text and languages](architecture/text.md) covers the catalog itself.

## The bar

The Russian must read as if a Russian game writer wrote it first. Think of Ex Machina, Space Rangers 2 and Дальнобойщики: terse, dry, a bit rough, never bureaucratic. A player must never be able to guess the English behind a line.

Translate what the line means where the player sees it, not its words. The key tells you where it shows:

- `line.*` is a driver speaking on the radio. It is speech: short, spoken, rude when the English is rude.
- `radio.*` is J.J.'s radio show. It is a DJ talking to drivers, with jokes.
- `goal.*` is a short status under an NPC's name. It says what the driver is doing or why it stopped.
- `log.*` and `note.*` are log lines. They read like a terse logbook.
- `refusal.*` tells the player why an action did not work.
- `inv.*`, `trade.*`, `weapon.*`, `hud.*`, `menu.*` and the like are buttons, labels and tooltips. They follow Russian UI habits.

## Rules

1. No "label: value" lines unless the English is a label. A colon instead of a sentence is the main tell of machine text.
2. Numbers sit inside the sentence, with the word in the right case. Write «Нужно 40 опыта, у вас 12», not «Нужно опыта: 40, у вас: 12».
3. Never chop a word to fit. Use a standard abbreviation with a period, like «прочн.», «доп.», «шт.», «КПП», or pick a shorter word. A reader must recognize every short label without seeing the full word.
4. Use active verbs and drop possessives Russian does not need. Write «Сначала остановите грузовик», not «Сначала остановите ваш грузовик». Avoid «является», «осуществить» and «был произведён».
5. Keep the register. UI and the log address the player as «вы». Drivers on the radio say «ты» to the player, even a gang speaking as «мы».
6. Keep the subject's number and gender. An NPC status is about one driver: «Покинул пост», not «Покинули пост».
7. Idioms carry meaning, not words. "You look dry" is about fuel, so «бак, смотрю, пустой», not «ты на мели», which means broke.
8. Plurals give all four forms, `one`, `few`, `many` and `other`. `other` is the form for fractions, like «1,5 хода».
9. Stay close to the English length. A button or label may grow by a third at most. The layout check fails on clipped text.
10. Use one word per concept, from the glossary below.

## Names in sentences

A name inside a sentence takes the case the grammar needs, and the verb agrees with its gender. [Text and languages](architecture/text.md) has the syntax.

- `log.patchDoneYou`: «Вы починили: {who}.» → «Вы починили {who, case, acc}.»
- `log.patchDoneThem`: «{who} починил ваш грузовик.» → «{who} {who, gender, m {починил} f {починила} n {починило} pl {починили}} ваш грузовик.»
- `job.repair`: «Ремонт: {part}» → «Ремонт {part, case, gen}».
- `log.towOffer`: «…дотащить вас, пункт — {site}…» → «…дотащить вас до {site, case, gen}…».
- `log.breakdown`: «Сломалось: {part}» → «{part} {part, gender, m {сломался} f {сломалась} n {сломалось} pl {сломались}}».

A new name entry is a `noun()` with all six forms and its gender. Write the forms in lower case unless the name is a proper name, like a place. Check each form in a sentence: «нет …», «дать …», «вижу …», «с …», «о …».

## Examples

Bad, then good, with the reason.

- `refusal.needsXp`: «Нужно опыта: {cost}, у вас: {have}» → «Нужно {cost} опыта, у вас {have}». A form, not a sentence.
- `short.gun`, `short.arm`: «Орд», «Брн» → «Оруж», «Брон». A chopped word nobody can read.
- `inv.patch`: «Ремонт {turns}х/{parts}зч» → «Ремонт: {turns} х., {parts} дет.». Made-up abbreviations.
- `job.search`: «Обыск» → «Поиски». «Обыск» is a police search of a person or a house.
- `goal.leftPost`: «Покинули пост» → «Покинул пост». The status is about one driver.
- `goal.ranFromIt`: «Убежали от неё» → «Сбежал от него». Wrong number, and грузовик is masculine.
- `goal.watchedRoad`: «Дорога осмотрена» → «Осмотрел дорогу». The other statuses are active, so this one is too.
- `goal.finishedService`: «Обслужился» → «Прошёл обслуживание». Not a Russian word in this sense.
- `goal.prowledRoad`: «Обрыскал дорогу» → «Прочесал дорогу». A made-up verb.
- `log.scrapPatch`: «Вы латаете машину ломом, пока она снова не трогается с места» → «Вы латаете машину ломом, и она снова трогается с места». A calque of "until".
- `inv.loadTitle`: «Масса против номинального груза» → «Масса и допустимая нагрузка». "Against" is not «против» here.
- `trade.hint.flooded`: «завал» → «затоварено». The market term.
- `radio.dawn.1`: «Утро, мальчики» → «Доброе утро, мужики». A DJ talking to drivers, not to children.
- `line.itIsYours`: «Он ваш» → «Твоё». Radio speech says «ты».
- `line.overMyWreck`: «Только через мой обломок» → «Сначала придётся меня разбить». The meaning, not a word-for-word pun.
- `opening.stranded`: «Вы очутились на мели» → «Вы застряли в незнакомых краях». «На мели» reads as broke.

Good lines to match:

- `log.weather.overcast.started`: «Небо затянуло», not «Началась облачность».
- `state.revenge`: «Жаждет мести».
- `line.findersKeepers`: «Кто нашёл, того и добыча».
- `line.noTimeOut`: «Некогда. Отбой.»

## Glossary

- truck: грузовик. Car, when the English says car: машина.
- raider: рейдер. Scavenger: мусорщик. Vulture: стервятник. Roamer: бродяга. Trader: торговец.
- scrap: лом. Scrap metal: металлолом. Wreck: обломки. Loot: добыча.
- tow: буксир. To tow: тащить на буксире.
- patch: ремонт. To patch: подлатать.
- search of a site: поиски. To search: обшарить.
- parked: на стоянке. Pad: площадка. Garage storage: гараж.
- skill: умение. Perk: навык. XP: опыт.
- HP of a part: прочность. Short form: прочн.
- turn: ход. Never on the radio.
- refit: переоснащение. Mount: крепление.
