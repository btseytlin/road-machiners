# Items

Every chassis, part and good in the game. Value is money for a pristine item. Every price derives from it, see [economy.md](economy.md). Mass is per part in kilograms, and per unit for goods. Footprints are in grid cells. One cell is `RULES.cellMeters` meters wide.

Parts are defined in `src/data/parts.ts`, chassis in `src/data/chassis.ts` and goods in `src/data/goods.ts`. A value is a hand-set base plus a modifier from the stats the kind is bought for. The modifier numbers are `PART_PRICE_MODIFIERS` for parts and `CHASSIS_PRICE_MODIFIERS` for chassis. Core parts come built into a chassis at fixed cells and are never sold.

## Chassis

<!-- wiki:chassis -->
| id | name | tier | value (M) | max speed (tiles/turn) | accel | brake | mass (kg) | rated mass (kg) | radius (tiles) | fuel cap | fuel per tile | grid (w x h) | core parts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scout | Scout pickup | 1 | 815 | 7.8 | 2 | 3 | 680 | 2465 | 0.6 | 40 | 0.25 | 7 x 8 | cabPickup, transmission, tank, wheel, wheel, wheel, wheel |
| hauler | Hauler | 2 | 1,226 | 5.2 | 1 | 2 | 2730 | 5840 | 0.8 | 80 | 0.4 | 9 x 9 | cabPickup, transmissionMid, tankMid, wheelMid, wheelMid, wheelMid, wheelMid |
| buggy | Buggy | 1 | 643 | 9.1 | 3 | 3 | 230 | 1830 | 0.5 | 30 | 0.2 | 6 x 8 | cab, transmission, tank, wheel, wheel, wheel, wheel |
| wagon | Gunwagon | 2 | 1,008 | 3.9 | 1 | 2 | 2130 | 4135 | 0.8 | 60 | 0.4 | 8 x 7 | cab, transmissionHeavy, tankHeavy, wheelHeavy, wheelHeavy, wheelHeavy, wheelHeavy |
| courier | Courier | 1 | 774 | 9.75 | 3 | 3 | 280 | 2175 | 0.5 | 24 | 0.18 | 6 x 9 | cab, transmission, tank, wheel, wheel, wheel, wheel |
| van | Utility van | 2 | 1,027 | 6.5 | 1.5 | 3 | 1100 | 3290 | 0.7 | 55 | 0.24 | 7 x 9 | cabPickup, transmissionMid, tankMid, wheelMid, wheelMid, wheelMid, wheelMid |
| longbed | Longbed truck | 3 | 1,795 | 4.55 | 0.8 | 1.8 | 2900 | 6930 | 0.95 | 100 | 0.48 | 9 x 11 | cabPickup, transmissionHeavy, tankHeavy, wheelHeavy, wheelHeavy, wheelHeavy, wheelHeavy |
| carrier | Armored carrier | 3 | 1,626 | 5.2 | 1 | 2.5 | 3200 | 5795 | 0.85 | 70 | 0.5 | 8 x 9 | cabPickup, transmissionHeavy, tankHeavy, wheelHeavy, wheelHeavy, wheelHeavy, wheelHeavy |
| tractor | Heavy tractor | 3 | 1,461 | 3.9 | 1.8 | 2 | 3600 | 6710 | 0.9 | 120 | 0.6 | 9 x 9 | cabPickup, transmissionHeavy, tankHeavy, wheelHeavy, wheelHeavy, wheelHeavy, wheelHeavy |
| jeep | Jeep | 1 | 729 | 8.2 | 2.5 | 3 | 450 | 2345 | 0.55 | 35 | 0.2 | 6 x 9 | cab, transmission, tank, wheel, wheel, wheel, wheel |
| convertible | Convertible | 2 | 998 | 9.4 | 2.5 | 3 | 750 | 2940 | 0.6 | 45 | 0.26 | 7 x 9 | cabHardtop, transmission, tankLong, wheel, wheel, wheel, wheel |
| bus | Bus | 2 | 1,267 | 5.5 | 0.9 | 2 | 3000 | 6810 | 0.9 | 110 | 0.45 | 8 x 12 | cabPickup, transmissionMid, tankMid, wheelMid, wheelMid, wheelMid, wheelMid |
| loader | Wheel loader | 3 | 1,696 | 3.6 | 1.6 | 2.5 | 4200 | 7310 | 0.9 | 130 | 0.65 | 9 x 9 | cabPickup, transmissionHeavy, tankHeavy, wheelHeavy, wheelHeavy, wheelHeavy, wheelHeavy |
| niva | Niva | 2 | 1,050 | 7.6 | 2.2 | 3 | 520 | 2710 | 0.55 | 42 | 0.21 | 6 x 10 | cab, transmissionMid, tank, wheelMid, wheelMid, wheelMid, wheelMid |
| bukhanka | Bukhanka | 2 | 1,150 | 6 | 1.4 | 2.5 | 1250 | 3735 | 0.65 | 78 | 0.3 | 7 x 10 | cabPickup, transmissionMid, tankMid, wheelMid, wheelMid, wheelMid, wheelMid |
| lincoln | Lincoln | 3 | 1,430 | 8.6 | 2 | 2.2 | 900 | 3790 | 0.85 | 85 | 0.36 | 7 x 11 | cabHardtop, transmission, tankLong, wheel, wheel, wheel, wheel |
<!-- /wiki:chassis -->

## Weapons

`armor` is the penetration a part stops when a round passes through it. A tall part blocks a mounted gun from firing across it. How a shot resolves is in [combat.md](combat.md).

<!-- wiki:weapons -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | range (tiles) | cooldown (turns) | magazine (shots) | reload (turns) | arc (deg) | spread (deg) | rounds per shot | recoil (deg) | shake | line (turns) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mg | MG turret | 1 | 49 | 1 x 2 | 110 | 40 | 3 | false | 12 | 1 | 5 | 2 | 270 | 5 | 6 | 0.5 | 0.5 |  |
| shotgun | Shotgun | 1 | 60 | 1 x 2 | 100 | 36 | 2 | false | 10 | 1 | 2 | 2 | 90 | 12 | 10 | 1.5 | 0.6 |  |
| longRifle | Long rifle | 1 | 54 | 1 x 2 | 120 | 30 | 2 | false | 18 | 1 | 3 | 2 | 60 | 1 | 1 | 0.8 | 1 |  |
| flamer | Flamer | 1 | 69 | 1 x 2 | 100 | 34 | 2 | false | 8 | 1 | 3 | 2 | 90 | 7 | 8 | 0.3 | 0.6 |  |
| pneumobolter | Pneumobolter | 1 | 69 | 2 x 2 | 150 | 44 | 3 | false | 14 | 1 | 2 | 1 | 60 | 1.6 | 1 | 1.5 | 1.5 |  |
| slugCannon | Slug cannon | 1 | 67 | 1 x 2 | 160 | 46 | 3 | false | 16 | 1 | 3 | 2 | 180 | 2 | 2 | 3 | 1.5 |  |
| heavyMg | Heavy MG | 2 | 88 | 1 x 2 | 95 | 50 | 4 | false | 13 | 1 | 5 | 2 | 270 | 4 | 6 | 1.5 | 0.6 |  |
| cannon | Forward cannon | 2 | 114 | 2 x 2 | 270 | 60 | 3 | true | 13 | 1 | 2 | 2 | 60 | 3.5 | 1 | 6 | 1 |  |
| amRifle | Anti-materiel rifle | 2 | 78 | 1 x 3 | 190 | 40 | 2 | false | 19 | 1 | 3 | 3 | 45 | 0.8 | 1 | 2 | 1.2 |  |
| autocannon | Autocannon | 2 | 126 | 2 x 2 | 180 | 56 | 4 | false | 12 | 1 | 4 | 2 | 180 | 4 | 3 | 3 | 0.8 |  |
| recoilless | Recoilless rifle | 2 | 109 | 1 x 3 | 150 | 40 | 2 | false | 15 | 1 | 2 | 2 | 45 | 1.4 | 1 | 1 | 2 |  |
| battleRifle | Battle rifle | 2 | 117 | 1 x 3 | 150 | 44 | 3 | false | 17 | 1 | 5 | 1 | 180 | 1.6 | 3 | 2 | 1.4 |  |
| gatling | Gatling MG | 3 | 170 | 2 x 2 | 150 | 70 | 5 | false | 14 | 1 | 6 | 3 | 270 | 5 | 12 | 2 | 0.7 |  |
| rocketRack | Rocket rack | 3 | 165 | 2 x 2 | 110 | 32 | 1 | false | 14 | 1 | 1 | 3 | 90 | 6 | 4 | 1 | 1.2 |  |
| sniperCannon | Sniper cannon | 3 | 205 | 2 x 3 | 180 | 40 | 2 | true | 20 | 1 | 3 | 3 | 30 | 0.6 | 1 | 2 | 1.4 |  |
| grenadeLauncher | Grenade launcher | 3 | 196 | 2 x 2 | 130 | 50 | 4 | false | 12 | 1 | 4 | 3 | 180 | 5 | 3 | 2 | 1 |  |
| tankGun | Tank gun | 3 | 202 | 2 x 3 | 210 | 90 | 8 | true | 16 | 1 | 2 | 2 | 45 | 2 | 1 | 8 | 2 |  |
| flechette | Flechette gun | 3 | 219 | 2 x 2 | 120 | 44 | 3 | false | 18 | 1 | 4 | 2 | 180 | 1.2 | 4 | 1.5 | 1.5 |  |
| harpoon | Harpoon | 2 | 96 | 1 x 2 | 120 | 40 | 4 | false | 8 | 1 | 1 | 5 | 270 | 1 | 1 | 0 | 0.3 | 10 |
<!-- /wiki:weapons -->

Each weapon's round:

<!-- wiki:weapon-rounds -->
| id | damage | pen | blast | speed (m/s) | splash radius (m) | splash damage | splash pen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mg | 2.5 | 5 | false | 600 | 0 | 0 | 0 |
| shotgun | 9 | 4 | false | 350 | 0 | 0 | 0 |
| longRifle | 21 | 7 | false | 900 | 0 | 0 | 0 |
| flamer | 10 | 3 | true | 40 | 1.5 | 1.5 | 2 |
| pneumobolter | 54 | 6 | false | 200 | 0 | 0 | 0 |
| slugCannon | 12 | 6 | false | 450 | 0 | 0 | 0 |
| heavyMg | 3.5 | 9 | false | 700 | 0 | 0 | 0 |
| cannon | 95 | 10 | true | 250 | 2.5 | 12 | 5 |
| amRifle | 35 | 15 | false | 950 | 0 | 0 | 0 |
| autocannon | 18 | 9 | false | 700 | 0 | 0 | 0 |
| recoilless | 72 | 13 | true | 220 | 1.5 | 8 | 4 |
| battleRifle | 12 | 13 | false | 800 | 0 | 0 | 0 |
| gatling | 3 | 11 | false | 750 | 0 | 0 | 0 |
| rocketRack | 60 | 10 | true | 90 | 3 | 8 | 4 |
| sniperCannon | 77 | 17 | false | 950 | 0 | 0 | 0 |
| grenadeLauncher | 24 | 7 | true | 120 | 2 | 6 | 4 |
| tankGun | 114 | 14 | false | 500 | 1.5 | 10 | 5 |
| flechette | 15 | 14 | false | 1100 | 0 | 0 | 0 |
| harpoon | 6 | 3 | false | 1000 | 0 | 0 | 0 |
<!-- /wiki:weapon-rounds -->

## Engines

<!-- wiki:engines -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | speed bonus | accel bonus | fuel mult | noise | heat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| stockEngine | Stock engine | 1 | 50 | 2 x 2 | 360 | 50 | 4 | false | 0 | 0 | 1 | 1 | 1 |
| tunedEngine | Tuned V8 | 2 | 116 | 2 x 2 | 300 | 40 | 4 | false | 1.3 | 1 | 1.4 | 1.3 | 1.2 |
| flatFour | Light flat-four | 1 | 34 | 2 x 2 | 224 | 36 | 2 | false | -1.3 | 0 | 0.75 | 0.7 | 0.7 |
| workhorseDiesel | Workhorse diesel | 2 | 84 | 2 x 2 | 320 | 80 | 6 | false | -0.65 | 0.5 | 0.7 | 1.2 | 0.6 |
| racingV6 | Racing V6 | 2 | 139 | 2 x 2 | 240 | 32 | 2 | false | 1.95 | 0.5 | 1.25 | 1.4 | 1.6 |
| heavyDiesel | Heavy diesel | 3 | 151 | 2 x 2 | 280 | 110 | 8 | false | -1.3 | 1.5 | 1.1 | 1.5 | 0.8 |
| turbine | Turbine | 3 | 249 | 2 x 2 | 220 | 44 | 3 | false | 2.6 | 2 | 2.2 | 1.8 | 2 |
<!-- /wiki:engines -->

## Armor

`armor` stops kinetic rounds and `blast armor` stops blast rounds and splash. Field repair says how far a repair on the road restores the part. A claymore ram holds a charge that the driver arms. It blasts on the next hard truck crash on its side.

<!-- wiki:armor -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | blast armor | field repair | ram mult | claymore |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plates | Steel plates | 2 | 102 | 1 x 3 | 84.375 | 80 | 12 | false | 12 | capped | 1 |  |
| cage | Rebar cage | 1 | 73 | 1 x 2 | 41.25 | 60 | 2 | false | 20 | capped | 1 |  |
| ram | Ram bar | 2 | 110 | 3 x 1 | 180 | 100 | 20 | false | 8 | capped | 2 |  |
| scrapPanels | Scrap panels | 1 | 50 | 1 x 2 | 75 | 44 | 5 | false | 5 | full | 1 |  |
| ceramicPlates | Ceramic plates | 2 | 150 | 1 x 2 | 37.5 | 36 | 22 | false | 8 | none | 1 |  |
| spacedArmor | Spaced armor | 2 | 142 | 1 x 4 | 97.5 | 110 | 10 | false | 28 | capped | 1 |  |
| reinforcedCage | Reinforced cage | 2 | 117 | 1 x 3 | 67.5 | 130 | 4 | false | 26 | capped | 1.2 |  |
| plowRam | Plow ram | 3 | 201 | 3 x 1 | 157.5 | 170 | 25 | false | 12 | none | 2.8 |  |
| claymoreRam | Claymore ram | 2 | 132 | 3 x 1 | 142.5 | 60 | 10 | false | 6 | capped | 1.5 | {"minImpact":3,"blast":{"damage":60,"pen":12,"radius":2},"selfBlast":{"damage":25,"pen":6},"throw":{"impulse":40000,"lift":0.35},"reload":20} |
| steelPlate | Steel plate | 2 | 66 | 1 x 1 | 30 | 28 | 12 | false | 12 | capped | 1 |  |
| scrapSheet | Scrap sheet | 1 | 34 | 1 x 1 | 37.5 | 22 | 5 | false | 5 | full | 1 |  |
| ceramicTile | Ceramic tile | 2 | 87 | 1 x 1 | 18.75 | 18 | 22 | false | 8 | none | 1 |  |
<!-- /wiki:armor -->

## Cargo

<!-- wiki:cargo -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | extra rows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rack | Roof rack | 1 | 40 | 2 x 1 | 60 | 30 | 1 | false | 1 |
| trailerBox | Cargo box | 2 | 100 | 2 x 2 | 135 | 60 | 1 | true | 3 |
| panniers | Panniers | 1 | 34 | 1 x 1 | 60 | 20 | 1 | false | 1 |
| flatbed | Flatbed extension | 1 | 67 | 2 x 1 | 120 | 50 | 1 | false | 2 |
| lightFrame | Light cargo frame | 2 | 127 | 2 x 2 | 90 | 24 | 1 | false | 3 |
| enclosedFrame | Enclosed cargo frame | 2 | 147 | 2 x 2 | 165 | 110 | 8 | true | 3 |
| heavyFrame | Heavy cargo frame | 3 | 217 | 2 x 2 | 175 | 90 | 3 | true | 5 |
<!-- /wiki:cargo -->

## Scanners

<!-- wiki:scanners -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | range (tiles) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scanner | Radio scanner | 2 | 117 | 1 x 1 | 30 | 30 | 2 | false | 160 |
<!-- /wiki:scanners -->

## Stores

<!-- wiki:stores -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | holds | amount (units) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jerrycans | Jerrycan rack | 1 | 44 | 1 x 1 | 70 | 30 | 1 | false | fuel | 12 |
| supplyLocker | Supply locker | 1 | 44 | 1 x 1 | 60 | 30 | 2 | false | supplies | 10 |
<!-- /wiki:stores -->

## Utilities

Yellow deck parts with one job each. An active utility acts once on an order and then recharges for its reload in turns. Each wear step adds 10% to the reload, rounded up. The patcher crane and the scraper's knife are passive and work while mounted.

<!-- wiki:utilities -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | effect | reload (turns) | effect numbers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sprout | Sprout | 1 | 57 | 1 x 1 | 60 | 25 | 2 | false | sprout | 10 | {"radius":5,"turns":6} |
| caltrops | Caltrops | 1 | 47 | 1 x 1 | 70 | 30 | 3 | false | caltrops | 10 | {"radius":1.25,"turns":10,"behind":1} |
| oilSpiller | Oil spiller | 1 | 57 | 1 x 1 | 90 | 30 | 3 | false | oil | 6 | {"slick":5.8,"turns":8,"behind":1,"fuel":2} |
| patcherCrane | Patcher crane | 1 | 60 | 1 x 2 | 150 | 50 | 4 | false | crane |  | {} |
| smokeMortar | Smoke mortar | 2 | 107 | 1 x 2 | 110 | 36 | 3 | false | mortar | 8 | {"radius":4,"turns":5,"minRange":5,"maxRange":16} |
| flareCannon | Flare cannon | 2 | 74 | 1 x 1 | 50 | 28 | 2 | false | flare | 10 | {"radius":10,"turns":6,"minRange":4,"maxRange":24} |
| scrapersKnife | Scraper's knife | 2 | 94 | 1 x 2 | 170 | 50 | 4 | false | scraper |  | {} |
| emitter | Emitter | 3 | 250 | 2 x 2 | 200 | 44 | 4 | false | emitter | 10 | {"radius":6,"turns":2} |
<!-- /wiki:utilities -->

## Core parts

<!-- wiki:core -->
| id | name | tier | value (M) | cells (w x h) | mass (kg) | hp | armor | tall | role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cab | Driver seat | 1 | 67 | 1 x 2 | 80 | 120 | 3 | true | cab |
| cabPickup | Cab | 1 | 67 | 3 x 2 | 80 | 120 | 3 | true | cab |
| cabHardtop | Hardtop cab | 1 | 67 | 3 x 2 | 80 | 120 | 3 | true | cab |
| transmission | Transmission | 1 | 50 | 2 x 2 | 60 | 40 | 3 | false | transmission |
| transmissionMid | Truck transmission | 1 | 57 | 2 x 2 | 60 | 60 | 4 | false | transmission |
| transmissionHeavy | Heavy transmission | 1 | 67 | 2 x 2 | 60 | 90 | 6 | false | transmission |
| wheel | Wheel | 1 | 14 | 1 x 2 | 25 | 30 | 2 | false | wheel |
| wheelMid | Truck wheel | 1 | 20 | 1 x 2 | 25 | 50 | 3 | false | wheel |
| wheelHeavy | Heavy wheel | 1 | 30 | 1 x 2 | 25 | 80 | 5 | false | wheel |
| tank | Small fuel tank | 1 | 20 | 1 x 2 | 30 | 30 | 1 | false | tank |
| tankLong | Fuel tank | 1 | 20 | 1 x 2 | 30 | 30 | 1 | false | tank |
| tankMid | Truck fuel tank | 1 | 27 | 1 x 2 | 30 | 50 | 3 | false | tank |
| tankHeavy | Armored fuel tank | 1 | 37 | 1 x 2 | 30 | 80 | 6 | false | tank |
<!-- /wiki:core -->

## Goods

<!-- wiki:goods -->
| id | name | tier | value (M) | mass per unit (kg) |
| --- | --- | --- | --- | --- |
| scrap | Scrap metal | 1 | 7 | 100 |
| salt | Salt | 1 | 9 | 75 |
| meds | Meds | 2 | 24 | 50 |
| grain | Grain | 1 | 7 | 90 |
| textiles | Textiles | 1 | 12 | 25 |
| tools | Machine tools | 3 | 37 | 160 |
| batteries | Batteries | 2 | 26 | 120 |
| electronics | Electronics | 3 | 52 | 15 |
| parts | Parts | 1 | 7 | 20 |
| fuelDrums | Fuel drums | 1 | 10 | 140 |
| water | Water | 1 | 6 | 110 |
<!-- /wiki:goods -->

## Numbers

<!-- wiki:numbers -->
| path | value |
| --- | --- |
| `RULES.cellMeters` | 0.5 |
<!-- /wiki:numbers -->
