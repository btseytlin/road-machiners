# Sight and detection

Sight, engine sound, dust, the radio scanner and how NPCs react to contacts. The principles behind them are in [DESIGN.md](../../DESIGN.md).

Sight reaches 20 tiles with line of sight, halved at night and cut in dust storms. A vehicle within 3 tiles is seen even behind a hill. Gray vision shows ground and buildings out to four sight radii, but no vehicles. Beyond sight, a moving vehicle still gives itself away: engine sound, dust clouds, or a mounted radio scanner.

A contact is a vehicle detected this way. It is a rough circle that always holds the true position. For sound the circle grows with distance, so a far sound gives little more than a direction. A scanner fixes a position much more tightly.

Engine sound reaches far, by the engine and the vehicle's speed. A crawling truck is heard only a little past sight, and a parked truck makes no sound. Hills do not block it. The listener's own speed shortens its hearing, so a parked observer hears furthest. Sound shows as faint arcs around the player's truck, pointing toward each heard truck: a wide arc for a vague bearing, a thick one for a loud engine, a bright one for a near sound. The arcs hum and ripple outward.

Dust clouds are objects in the world. Every turn a truck moving faster than a crawl on dusty ground leaves a cloud behind it. Roads and mud raise little dust, sand and ash raise more, and none rises at night. A cloud rises, drifts back along its truck's route and with the wind, wanders a little, and fades after a few turns. Once risen it is seen from far beyond sight and over hills. So a line of clouds shows where a truck passed, a little late.

A radio scanner is a part that mounts on a deck cell, so it competes with a gun. It detects every moving vehicle within 160 tiles, through hills, and shows it as a steady blip. Bowl, Nose and the Pump Station sell it.

NPCs detect the player and each other with the same rules. A meeting far from the player is simpler: out of the player's live range, a truck sees another inside its sight radius whatever stands between them, and dust risen over hills is not seen. Any meeting with a truck inside the live range uses the full rules. A contact makes an NPC react only when its circle is small enough for the NPC's traits. Vague distant sounds stay audible without redirecting an NPC. Scanner and beacon contacts stay useful from farther away. A useful hostile contact fires one decision: keep, investigate or flee. Raiders mostly investigate, and traders and scavengers mostly flee. An investigation drives to where the contact first was and ends on arrival. A fighter that loses sight of its target drives to where it last saw it. Each turn it hears the engine or sees the dust, it turns toward that contact. After about 6 turns with neither, it gives up. A driver busy with trade, salvage, service or repairs mostly keeps on.
