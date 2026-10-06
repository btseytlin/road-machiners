import type { Tier } from './market';
import type { LandmarkLook } from '../sim/types';
// Global rule numbers. Tuned by playing.

export const RULES = {
  // Movement
  substeps: 26, // per turn; step length must stay below the smallest collision radius
  crawlSpeed: 1, // below this speed turning slows toward a standstill
  lowFuelThreshold: 0.2, // share of tank remaining when speed is limited
  lowFuelSpeedFactor: 0.5, // share of normal top speed below the threshold
  fuelUseFactor: 0.045, // share of the chassis fuel rate burned per tile; a daytime Bowl to Nose road trip uses under 36% of the starting fuel, leaving room for detours and fights
  npcStuckTurns: 2, // failed drive attempts before backing out
  npcRecoveryTurns: 2, // turns spent backing out before resuming the route
  // An NPC that stays put `turns` turns in a row while its goal point is out of reach, for any reason, drives `driveTurns`
  // turns to a random free spot `reach` tiles away or closer, then takes up its goal again. A wait for traffic or an
  // escort lasts a few turns, so 20 turns catches only waits that do not end. 6 tiles is a few truck lengths: off a
  // blocked lane, still near the goal.
  unstick: { turns: 20, reach: 6, driveTurns: 3 },
  // A truck that ends `turns` turns in a row flipped or lifted off the ground, like on top of another truck, is set down
  // on its wheels. It lands on the nearest free spot, searched in rings `step` tiles apart. The step is below the
  // smallest vehicle radius.
  stranded: { turns: 3, step: 0.25 },
  // A player click within throttle reach and less than `cone` degrees off straight behind backs the truck up.
  // Any other point behind turns the truck around nose first. A truck blocked in front, or a stuck NPC, backs out `distance` tiles.
  reverse: { cone: 20, distance: 1 },
  // A driver that parks beside another truck tries points around it `meetStep` radians apart when the nearest is taken.
  // 0.3 rad is under a truck length at the usual meeting distance, so no truck-wide gap is skipped.
  meetStep: 0.3,
  arriveRadius: 0.5, // a stop order clears inside this distance
  // Throttle zones ahead of the truck. They span `reach` tiles, split into brake, hold and accelerate
  // shares in that order. A click's distance picks the zone.
  throttleZones: { reach: 10, brake: 0.25, hold: 0.5, accelerate: 0.25 },
  reclickRadius: 0.75, // tiles; a click this close to the order's point switches its kind
  passRadius: 1, // a drive-through order clears once the truck passes this close to its point, or drives past it
  minAimDistance: 1.5, // tiles; steering ignores route points closer than this
  cornerSlack: 2, // tiles past a route corner the brake plan allows
  refitTurnsPerPart: 2.5, // turns to take a part off a mount or put one on; a job rounds its total up
  parkedSpeed: 0.5, // vehicles slower than this are routed around like obstacles
  yieldDistance: 1.5, // tiles neutral drivers keep past both radii from a vehicle ahead, beyond what both close before they stop; see src/sim/ai.ts
  maxBulge: 0.25, // tiles a steering arc may stray from the straight route line
  limpSpeed: 1.04, // 15 km/h, top speed with an empty tank or a dead engine or transmission; a truck this slow raises no dust
  // Working guns slow the truck: top speed and acceleration scale by 1 - gunDragMax * min(1, draw / capacity) ** gunDragCurve.
  // Draw sums the guns' `draw`, capacity is the engine's. The curve is convex, so the first guns cost little and a
  // deck packed with guns reaches the full 48%. With a stock engine (7), one or two light guns cost 2 to 8%, two
  // long rifles 12%, and seven 1-cell guns on a big deck 48%.
  gunDragMax: 0.48,
  gunDragCurve: 1.5,
  minSpeedCap: 1, // a heavy load never pushes max speed below this
  collisionMinImpact: 1.5, // slower bumps deal no damage
  // A crash gives each truck ramDamage × impact² in tiles per turn × the other body's share of both masses,
  // spread over the lanes of its struck side. An obstacle's share is 1. Squaring the impact, like crash
  // energy, keeps a full-speed crash at 6 as hard as before while a bump at 2 only scratches the paint.
  ramDamage: 2.5,
  // A crash into an obstacle faster than this, in tiles per turn, hits harder: its damage and penetration grow by
  // (impact / hardCrashSpeed)². About 58 km/h. A crash at 6 deals 2.25 times the damage, one at 8 four times, so
  // steering a fast enemy into a rock pays off.
  hardCrashSpeed: 4,
  cellPen: 0.5, // penetration every grid cell a round or crash passes costs, for the frame and bulk in the way
  crashPen: 4, // penetration of crash damage in each lane
  // A truck body hitting the ground takes crash damage times this. Falls are slow next to driving: a roll off a 3 m
  // drop lands at about 2.7 tiles per turn, and 3 makes that as hard as a wall crash at about 4.3.
  groundCrash: 3,
  // A truck landing on its wheels after a jump gives each working wheel ramDamage × crashDamage × (landing speed into the ground in
  // tiles per turn)² × this. A 3 m drop costs a wheel about 5 HP. Drops under 1 m land slower than collisionMinImpact.
  landingDamage: 0.25,
  wheelLoss: 0.15, // share of speed and turning lost per broken wheel
  tankLeak: 1, // fuel lost per turn with a broken tank

  // Global damage multipliers. Tune these to make every fight faster or slower.
  weaponDamage: 1.2375, // every weapon round and splash, guard guns included
  crashDamage: 1.125, // every crash and ram, into trucks and obstacles alike

  // Stray fire. A round that misses its target may hit another truck whose center lies within reach of the line
  // of fire, which runs on past the target by reach. Unintended damage summed to feudDamage counts as an attack.
  stray: {
    reach: 1.5, // tiles
    feudDamage: 40, // about one cannon hit or ten MG rounds
  },

  // Town guards. Each town gate has one gun. Every turn it shoots the nearest vehicle within range that fired.
  // Each round hits with a flat chance and enters a random lane of the side facing the gate.
  guards: {
    range: 12,
    rounds: 4,
    hitChance: 0.5,
    missOffset: 1.5,
    round: { damage: 6, pen: 8, blast: false, armorShare: 1 },
  },

  // Every truck's acceleration, in the sim and in physics, times this. Tune here to make all trucks livelier or
  // heavier at once.
  accelScale: 0.67,
  // Engine overdrive multiplies the player's top speed and acceleration by this. It heats the engine; see
  // ENGINE_HEAT.overdriveGain.
  overdriveBoost: 1.33,
  // Past the rated mass, top speed and turning also scale by (rated / mass) to this power. 500 kg over a 3000 kg rating
  // cuts them to about 54%, and 1000 kg over to about 32%.
  overloadExponent: 4,

  // Combat
  // A round that lands on the truck is a crit with this chance. A crit multiplies its damage and pen, so a few
  // lucky rounds can swing a fight that many small rolls would otherwise average out. A machine gun lands several
  // rounds a turn, so 0.04 gives it about one crit every few turns of hits, not one every turn.
  critChance: 0.04,
  critDamage: 2,
  critPen: 2,
  // A round's angular error has a spread in radians: weapon spread × (1 − gunnery), plus
  // leadError × crossing speed / round speed, plus shake × the gun's shake × own speed in m/s,
  // plus the gun's recoil over the truck mass in tonnes.
  // Range adds weapon spread × rangeFalloff[tier] × (distance / range)², on top of the target looking smaller far
  // away. At full range a tier 1 gun scatters four times as wide as up close, a tier 3 gun twice as wide.
  rangeFalloff: { 1: 3, 2: 2, 3: 1 } as Record<Tier, number>,
  leadError: 4.5, // share of the lead angle the gunner misjudges
  shake: 0.002, // radians of spread per m/s of the shooter's own speed
  // A target slower than stillSpeed tiles per turn stands still: its whole spread shrinks to stillSpread. Moving
  // matters, and a stuck truck is easy to hit.
  stillSpeed: 0.1,
  stillSpread: 0.6,
  cellMeters: 0.5, // width of one grid cell, for the size of an aimed part
  cabHealthShare: 0.25, // share of cab damage the player's character takes as health loss
  minHit: 0.05,
  maxHit: 0.95,
  killXp: 40,
  wreckRadiusScale: 1, // wreck obstacle radius relative to the vehicle
  maxKillWrecks: 12, // oldest wrecks from kills are cleared past this, so obstacles do not pile up

  // Supplies, per turn
  suppliesPerTurn: 0.009, // at base heat; a full load lasts about 920 daytime turns, enough to explore off the roads
  baseSupplies: 20, // supply cap before mounted supply stores
  suppliesLow: 4, // the HUD warns at or below this, about 180 daytime turns before running out
  starveDamage: 5, // character health lost per turn without supplies
  starveFloor: 30, // starving stops here, so only cab damage can kill
  maxHealth: 100,
  healPerTurn: 1, // health a parked player with supplies regains per turn; from the starve floor to full in 70 turns
  healSupplies: 0.01, // supplies spent per turn of healing, on top of the normal drain
  townHealMult: 5, // healing multiplier at a town, where the driver rests in a bed

  // Knockout
  defeatPatch: 0.25, // share of max hp broken core parts get back when a driver wakes from a knockout
  scrapPatch: 0.4, // share of max hp drive parts and of the tank a stranded, broke player with nothing to sell gets at a town; also the tank share a broke driver with a low tank gets at a serving site
  townPatch: 0.15, // share of max hp the engine, transmission, wheels, tank and cab get free when the player enters a town
  knockoutMaxTurns: 30, // a knockout ends after this many turns even if a hostile idles in sight
  surrenderParts: 2, // installed parts, best first, a robber takes with the cargo from a stranded player who gives up
  npcDeathChance: 0.05, // an NPC whose cab breaks dies into a wreck instead of a knockout
  cabKnock: {
    below: 0.5, // share of cab max hp where the band starts, in which cab damage may knock the driver out
    hazard: 0.75, // total over the band: exp(-hazard) of cabs worn from `below` to 0 never knock
    playerHealth: 75, // absolute health at and above which the player takes no cab knock
  },
  // A defeated NPC that spent this many turns in a row beyond the player's gray vision appears at its home pad, so
  // crawlers do not pile up on the map. 50 turns is a quarter of a day: a player who turns back still meets it.
  retreatTeleportTurns: 50,
};

// Debug console numbers. Distances are in tiles.
export const CHEATS = {
  spawnDistance: 10, // a spawned vehicle appears this far from the truck, inside sight range
  spawnAngles: 12, // points tried on the spawn circle before the ring search
  searchStep: 1, // spacing between rings and between points on a ring, in the free spot search
  searchRings: 20, // rings searched around a target before giving up
};

// Props a truck smashes through: fences, junk piles and dead trees. Every other prop holds like a wall. See breakProp() in
// src/sim/salvage.ts.
export const BREAKABLE = {
  kinds: ['fence', 'junk', 'deadTree'] as readonly LandmarkLook[], // landmark looks that break; a fence is planks, a junk pile loose scrap and a dead tree brittle wood
  breakSpeed: 3, // m/s, about 11 km/h: a truck rolling faster than walking pace breaks through, a creeping one stops
  slowdown: 0.3, // share of its speed a truck loses breaking through, so smashing a fence costs time
  damage: 2, // HP a break deals to the part that hit before armor: a scrape, a third of the softest wall crash (ramDamage × crashDamage × collisionMinImpact², about 6)
  regrowDays: 3, // game days before a broken prop may grow back, like a looted road wreck's wreckClearDays
  routeCost: 8, // step cost multiplier of a route cell under a breakable prop, so a detour of a few cells beats smashing through
};
