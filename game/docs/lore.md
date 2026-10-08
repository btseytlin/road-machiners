# Lore

## Icarus

Icarus was a fertile farming basin before the collapse. Orchards, fields, canals, irrigation gates, farm roads, and market towns shaped the land. It was not a spaceflight center. The name Icarus came after the crash. Its old name has not been chosen.

A huge spaceship broke apart while descending through the atmosphere. Its largest hull section lies in the central crater and is called the Fallen Sun. Engines, cargo sections, and escape pods fell across the basin, leaving a trail of wrecks and impact scars. No one agrees whether the crash happened before, during, or after the wider collapse.

People still live and trade here. Farmers protect the canals that still work and the remaining seed stores. Salvagers recover metal and machinery from the wrecks. Truckers carry food, water, fuel, and parts between settlements. An irrigation gate can matter as much as a cargo hold.

The landscape shows all three histories: old field boundaries and canals, the ship's debris trail, and newer truck roads connecting useful places. Hills, valleys, a canyon, and a dried riverbed divide the routes. The crash's date and the basin's old name remain open.

### Concept image prompt

Create a square, straight-down concept painting of Icarus for a post-apocalyptic truck RPG. This image is a reference for designing the playable 3D world, not a minimap or interface. Show the former farming basin with orchards, field boundaries, canals, irrigation gates, farm roads, and market towns. A huge spaceship broke apart during descent: the Fallen Sun, its largest hull section, lies in a central crater, while engines, cargo sections, and escape pods left a visible debris trail across the region. Show the living economy through surviving farms, salvagers at work, and truck routes between settlements. Include hills, valleys, a dramatic canyon, and a dried riverbed. Keep the old farm grid, violent impact trail, and newer winding roads visually distinct. Make the region large enough for long journeys between destinations. Use a hand-painted low-poly wasteland style, warm dust against traces of orchard green and cold ship metal. No text, labels, icons, borders, grid overlay, legend, interface, or perspective view.

## Waste Of Time Radio

Jill Jane, "J.J.", runs Waste Of Time Radio from a mast nobody has found. Her broadcasts stream onto the pager screen of the truck's radio. `src/data/radio.ts` holds her lines. Keep new lines in this voice:

- She reads the wasteland like an Old World farm-and-weather report, with crop-report formality, though no crops are left. That is the New World against the Old World.
- She is dry and gallows-funny. She calls listeners "road machiners" or "boys" and signs off with "Waste some time."
- She reports raids as business and never judges how anyone lives. She does frown on killing.
- She stays in character. She never says turns, quests, XP, levels, HP, keys, clicks, the player or the game. She gives no number other than a clock hour or a place name.
- Hints are road wisdom someone in the wasteland would say, like "Noon sun cooks an engine. Park in shade." Each matches a real rule in the [mechanics pages](wiki/mechanics/). A hint never says what to do next or how a control works.
- She names only places the listener has found. Anywhere else is a basin direction like "up north" or "in the southwest basin". She never quotes prices. The Rumor mill and Market ears perks keep that work.
- A line fits the three-line screen: 90 characters at most once its names are filled in.

## Settlement people

Bowl and Nose have locals the player talks to in town. `src/data/locals.ts` holds them and the journal notes their rumors leave. What each says is an ink quest in `src/data/quests/`. Keep new lines in these voices:

- Bowl is run by the canal families, a say for every gate, and guarded by the Bowl Farmers. Its people talk warm and slow, of crops, canals, water and seed. They think Nose is soldiers playing at a town.
- Nose is an Army post that became a town. The Army runs it: command gives orders, dispatch hands them out. Its people talk short and to the point. They think Bowl is slow but needed, since its grain feeds them.
- The locals are Ruben the canal warden, Hattie of the well house and Dag of the Farmers patrol at Bowl, and Sergeant Kovac at dispatch, Lena the mechanic and Old Ibo the radio man at Nose. Nose Army wagon Seven went dark on the Pump Station run to Bowl, and its crew walked home.
- Locals may be wrong, biased or out of date. Two of them may contradict each other. No line settles the crash date, the basin's old name or what the Fallen Sun was.
- Lines stay in character, as J.J.'s do. They never say turns, quests, XP, levels, HP, markers, waypoints, the map, clicks, the player or the game. They give no number other than a day count or a clock hour.
- A clue describes land the listener can see: a compass direction from a town, a named road or place, and the terrain there, like a hollow or an old farm with a water tower. It never gives a distance as a number or an exact spot.
