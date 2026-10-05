# Assets

Models and sound cues. The map from chassis and part ids to models is `src/render/partLooks.ts`, and the cue list is `src/data/sounds.ts`. Adding a model is described in [Art pipeline](../art.md), and sound in `docs/sound.md`.

## Models

Each chassis has one base model. Parts and goods have their own. A part with no entry is drawn by the base model.

<!-- wiki:models -->
| kind | id | model |
| --- | --- | --- |
| chassis | scout | base_scout |
| chassis | hauler | base_hauler |
| chassis | buggy | base_buggy |
| chassis | wagon | base_wagon |
| chassis | courier | base_courier |
| chassis | van | base_van |
| chassis | longbed | base_longbed |
| chassis | carrier | base_carrier |
| chassis | tractor | base_tractor |
| chassis | jeep | base_jeep |
| chassis | convertible | base_convertible |
| chassis | bus | base_bus |
| chassis | loader | base_loader |
| chassis | niva | base_niva |
| chassis | bukhanka | base_bukhanka |
| chassis | lincoln | base_lincoln |
| part | transmission | transmission |
| part | transmissionMid | transmission |
| part | transmissionHeavy | transmission |
| part | wheel | wheel |
| part | wheelMid | wheel |
| part | wheelHeavy | wheel |
| part | tank | fuel_tank |
| part | tankLong | fuel_tank |
| part | tankMid | fuel_tank |
| part | tankHeavy | fuel_tank |
| part | stockEngine | eng_stock |
| part | tunedEngine | eng_tuned_v8 |
| part | flatFour | eng_flat_four |
| part | workhorseDiesel | eng_workhorse_diesel |
| part | racingV6 | eng_racing_v6 |
| part | heavyDiesel | eng_heavy_diesel |
| part | turbine | eng_turbine |
| part | plates | arm_plates |
| part | cage | arm_cage |
| part | ram | arm_ram |
| part | scrapPanels | arm_scrap_panels |
| part | ceramicPlates | arm_ceramic_plates |
| part | spacedArmor | arm_spaced |
| part | reinforcedCage | arm_reinforced_cage |
| part | plowRam | arm_plow_ram |
| part | steelPlate | arm_plate |
| part | scrapSheet | arm_scrap_sheet |
| part | ceramicTile | arm_ceramic_tile |
| part | rack | cargo_rack |
| part | trailerBox | cargo_trailer_box |
| part | panniers | cargo_panniers |
| part | flatbed | cargo_flatbed |
| part | lightFrame | cargo_light_frame |
| part | enclosedFrame | cargo_enclosed_frame |
| part | heavyFrame | cargo_heavy_frame |
| part | scanner | scanner |
| part | jerrycans | store_jerrycans |
| part | supplyLocker | store_locker |
| good | scrap | good_scrap |
| good | salt | good_salt |
| good | meds | good_meds |
| good | grain | good_grain |
| good | textiles | good_textiles |
| good | tools | good_tools |
| good | batteries | good_batteries |
| good | electronics | good_electronics |
| good | parts | good_parts |
| good | fuelDrums | good_fuel_drums |
| good | water | good_water |
<!-- /wiki:models -->

## Weapon pools

A weapon is assembled from a mount, a receiver, a barrel and an optional extra. The part id picks from each pool.

<!-- wiki:weapon-pools -->
| weapon | mount | receiver | barrel | extra |
| --- | --- | --- | --- | --- |
| mg | wmount_ring_small, wmount_pintle | wrec_mg_a, wrec_mg_b | wbar_mg_short, wbar_mg_long, wbar_twin | wext_shield, wext_drum |
| shotgun | wmount_ring_small, wmount_pintle | wrec_shotgun | wbar_shotgun, wbar_twin | wext_shield, wext_drum |
| autocannon | wmount_ring_wide | wrec_autocannon | wbar_autocannon, wbar_twin | wext_drum, wext_shield |
| cannon | wmount_cradle | wrec_cannon | wbar_cannon | wext_shield, wext_scope |
| tankGun | wmount_cradle | wrec_tank | wbar_tank | wext_shield |
| rocketRack | wmount_ring_wide | wrec_rocket_pod | wbar_rocket_tubes |  |
| sniperCannon | wmount_cradle | wrec_sniper | wbar_sniper | wext_scope |
| longRifle | wmount_pintle | wrec_mg_b | wbar_mg_long | wext_scope |
| flamer | wmount_ring_small | wrec_shotgun | wbar_shotgun | wext_drum |
| pneumobolter | wmount_ring_small, wmount_pintle | wrec_autocannon | wbar_autocannon | wext_drum, wext_shield |
| slugCannon | wmount_ring_wide | wrec_autocannon | wbar_cannon | wext_shield |
| heavyMg | wmount_ring_small | wrec_mg_a, wrec_mg_b | wbar_mg_long, wbar_twin | wext_shield, wext_drum |
| amRifle | wmount_cradle | wrec_sniper | wbar_sniper | wext_scope |
| recoilless | wmount_ring_wide | wrec_cannon | wbar_cannon | wext_shield |
| battleRifle | wmount_pintle | wrec_mg_b | wbar_mg_long | wext_scope, wext_drum |
| gatling | wmount_ring_wide | wrec_autocannon | wbar_twin | wext_drum |
| grenadeLauncher | wmount_ring_wide | wrec_shotgun | wbar_autocannon | wext_drum |
| flechette | wmount_ring_small | wrec_mg_a | wbar_mg_long | wext_scope |
<!-- /wiki:weapon-pools -->

## Sound cues

<!-- wiki:sounds -->
| cue | bus | loop | volume | max voices | variants |
| --- | --- | --- | --- | --- | --- |
| ui-click | ui | false | 0.6 | 2 | 2 |
| ui-open | ui | false | 0.7 | 1 | 3 |
| ui-close | ui | false | 0.7 | 1 | 3 |
| ui-confirm | ui | false | 0.8 | 1 | 3 |
| radio | ui | false | 0.8 | 1 | 3 |
| ui-error | ui | false | 0.8 | 1 | 2 |
| money | ui | false | 0.8 | 1 | 3 |
| level-up | ui | false | 1 | 1 | 1 |
| discover | ui | false | 0.9 | 1 | 1 |
| air-brake | sfx | false | 0.5 | 1 | 3 |
| defeat | ui | false | 1 | 1 | 1 |
| mg-fire | sfx | false | 0.6 | 6 | 3 |
| cannon-fire | sfx | false | 0.9 | 3 | 1 |
| gun-empty | sfx | false | 0.8 | 3 | 1 |
| hit-metal | sfx | false | 0.55 | 6 | 3 |
| miss | sfx | false | 0.4 | 6 | 3 |
| part-broken | sfx | false | 0.7 | 2 | 3 |
| explosion | sfx | false | 1 | 2 | 3 |
| horn | sfx | false | 0.8 | 4 | 2 |
| crash | sfx | false | 0.9 | 2 | 2 |
| engine | sfx | true | 0.6 | 1 | 3 |
| wind | ambient | true | 1 | 1 | 3 |
| music-calm | music | true | 1 | 1 | 3 |
| score-drums | music | true | 0.9 | 1 | 1 |
| score-bass | music | true | 0.8 | 1 | 1 |
| accent-sighted | music | false | 0.85 | 3 | 2 |
| accent-struck | music | false | 0.85 | 3 | 2 |
| accent-miss | music | false | 0.75 | 3 | 2 |
| accent-hit | music | false | 1.3 | 3 | 2 |
| accent-crit | music | false | 0.95 | 3 | 2 |
| accent-crash | music | false | 1 | 3 | 2 |
<!-- /wiki:sounds -->

## Numbers

<!-- wiki:numbers -->
| path | value |
| --- | --- |
<!-- /wiki:numbers -->
