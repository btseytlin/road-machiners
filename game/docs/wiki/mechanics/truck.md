# Truck

The inventory grid, refits, mass, gun power draw, wear, breakdowns and field repair. The principles behind them are in [DESIGN.md](../../DESIGN.md).

The truck is equipment. It can be changed, upgraded, and destroyed. The truck stays critical to progression, like the ship in Space Rangers 2.

Each truck has an inventory grid, in the style of Dredge. Parts and goods all take cells, and the player arranges them by dragging and rotating.

The grid is a top view of the truck with the nose up. Each chassis marks deck cells, an engine bay and armor edges. Weapons, scanners, cargo frames and stores all mount on deck cells, so every deck cell is a choice between hauling and fighting. The engine bay is fixed per chassis. Armor mounts sit on the front, back, left and right edges, and plates and rams go on any side. A part works only while it lies fully on mounts of its own kind. Plain cells hold spare parts without installing them. Built-in parts sit on fixed cells: the cab, transmission, four wheels and fuel tank. They can be repaired but not removed. Heavier chassis carry tougher wheels, transmissions and tanks, so a gunwagon does not stall to a few machine gun bursts. An open seat takes 1x2 cells on small cars, and a closed cab takes 3x2 on the rest. The cab, the transmission and the engine keep clear of the wheel columns, and the transmission sits in the middle. A closed cab is tall. An open seat is not. The transmission is a 2x2 block and the fuel tank is two cells long. Empty mounts hold cargo like any other cell, so every mounted part costs cargo room. Parts have shapes: a cannon is a 3x1 bar, an engine is a 2x2 block.

Stores raise how much fuel and supplies a truck carries. A jerrycan rack adds 60 L of fuel. A supply locker adds half the base supplies. Each mounts on one deck cell, so it competes with a gun. A store counts only while mounted, and a broken one still holds. Removing a store spills whatever no longer fits. Bowl and Nose sell both. The Pump Station sells jerrycan racks, and the Granary sells supply lockers.

Cargo parts add full-width rows to the grid while mounted. A roof rack adds one row, a cargo box adds three.

Goods take one cell per unit and can be moved or dumped anywhere. Dragging an item onto another swaps them if both fit. Spare parts ride in the grid or wait in garage storage.

Garage equipment changes are instant. Outside town, a change is a refit job:

- Installing or removing a part takes 3 turns.
- Replacing an installed part with a spare takes 5 turns.
- Moving an installed part to another mount takes 5 turns.
- Installing a salvaged part takes 3 turns. The part stays in the stock until the job ends.
- Removing a part from a knocked-out truck takes 3 turns, and 5 when it goes straight onto a mount.

Machining shortens these times. The old layout stays active until the whole job finishes. Rearranging, storing, dumping or collecting items is blocked during a refit. Moving goods or spare parts without installing them stays instant.

Every part and good has a mass. A heavier truck accelerates, brakes, steers and tops out worse. Every kilogram counts: a truck lighter than its handling mass beats the listed speed, and a heavier one falls short. The rated mass is the load limit. Every truck can put tier 1 armor on all its armor cells and guns on half its deck and stay at or under it. Cargo and heavier gear use the rest of the room. Past the rated mass the loss is severe: 500 kg over a 3000 kg rating leaves about half the speed. For the same job a higher tier part weighs less, so better gear leaves more room. Trucks make tradeoffs: cargo vs armor vs fuel use. No truck is best at everything.

Every working gun draws power from the engine, and each gun slows the truck. A gun draws by its size and tier: its cells, plus a quarter more for each tier above the first. A machine gun draws 1, a long rifle 2 and a tank gun 4.5. The draw of all working guns, against the engine's capacity, cuts top speed and acceleration by up to 48%. The curve is convex, so the first guns cost little and a deck packed with guns hits the full 48%. On a stock engine, one or two light guns cost about 2 to 8%. A broken gun draws nothing. The gun and engine cards show the draw and the capacity. The truck headers in the inventory, shop and trade show the engine's power, the draw, what is spare or over, and what the draw costs in top speed. Hovering or focusing the HUD max speed lists every effect on it, from chassis to weather and towing, and its last line is the HUD number.

The engine is the general capability upgrade. Its capacity sets how many guns the truck carries before they slow it. A light flat-four carries few guns. A stock engine carries more, and a heavy diesel carries a fortress. The turbine and the racing V6 give raw speed, and the diesels give gun room.

No part is better than another of its kind at everything but price. Each has one job and one weakness, and a content test enforces it.

Parts wear. Each part has a wear level, from pristine to the last step. A part gains one wear step each time it drops to 0 HP. Fixing a damaged part that still works adds no wear. Each step lowers max HP and makes the part worse at its job: a gun scatters more, an engine gives less speed and acceleration, armor stops less and a scanner sees less far. A part that breaks at the last step is junk. Junk cannot be rebuilt, only stripped or sold for scrap. Built-in parts stop at the last step and never turn to junk, so old trucks slowly decline and the player changes trucks every so often. Parts move between trucks, so a change keeps some progress. Pristine parts are rare, so the player hunts for them.

Every turn the truck moves, each mounted part may lose HP. The chance grows with the tiles driven, the truck's speed, how rough the ground is and the weather. Roads wear parts least. Rarely, a part breaks down and loses a large share of its HP at once, logged in the event feed. More rarely, the engine or the transmission fails outright and drops to 0 HP, so the truck is stranded. A scout driven hard off road fails about once in two hours of play. A driver with parts patches it in the field, and one without needs a tow or a roadside patch. Wear and breakdowns never take the cab below 1 HP. The same rule wears NPC trucks, so stranded NPCs turn up on the roads in normal play.

Parts is a trade good, bought and sold like scrap or salt. It is the resource field repair spends. The standard start kit carries a few. Stripping a spare part is a parked job that turns it into units of parts. Its value sets the yield, so a broken or junk gun still pays.

A job is work that needs the truck parked for a number of turns: a refit, field repair or scavenging. The player has at most one job at a time. Driving before it ends cancels it and the turns already spent are lost. The HUD shows the current job and its turns left. A seen NPC shows its job and progress above its truck.

Field repair fixes one damaged mounted part. It spends parts and restores HP up to a field cap below full, only when the job finishes. The parts it spends are worth about the value it restores, so an expensive part costs more parts to fix. Machining shortens the job and raises the cap. A full repair to 100% still needs a shop. Scrap armor is the exception and patches to full on the road. Ceramic armor cannot be patched at all, only repaired at a shop. The inventory panel shows a Patch button on a damaged part, with its turns and parts cost.

Auto patch is on by default and toggles with P. Whenever the player truck is parked and idle, it patches the most damaged part with one unit of parts at a time. It leaves alone parts promised to a roadside patch.

NPCs use the same field repair. New NPCs carry up to two units of parts when their loadout has room. A damaged NPC prefers nearby shade, or repairs where it stopped. Low supplies and low fuel come before a repair detour.
