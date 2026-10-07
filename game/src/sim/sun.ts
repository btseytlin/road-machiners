// Time of day and the sun. Pure functions of the turn number.

import { TIME } from "../data/time";
import { isCheapMeeting } from "./fidelity";
import { shadeCastersAround } from "./prop-index";
import { weatherAt } from "./weather";
import type { Obstacle, World } from "./types";
import { propBase } from "./bridge";
import { heightAt } from "./terrain";
import { clamp, dist, type Vec } from "./vec";

// dir is the unit map direction toward the sun. elevation is its height above the horizon in radians.
export type Sun = { dir: Vec; elevation: number };

export function clockOf(turn: number): { day: number; hour: number } {
  const hours = TIME.startHour + ((turn - 1) * 24) / TIME.turnsPerDay;
  return { day: Math.floor(hours / 24) + 1, hour: hours % 24 };
}

// The sun rises in the east (+x), crosses the north (-y) at noon and sets in the west. Null at night.
// North is the far side from the camera, so terrain shadows fall toward the viewer.
export function sunAt(turn: number): Sun | null {
  const { hour } = clockOf(turn);
  if (hour <= TIME.sunrise || hour >= TIME.sunset) return null;
  const t = (hour - TIME.sunrise) / (TIME.sunset - TIME.sunrise);
  const elevation =
    Math.sin(Math.PI * t) * TIME.noonElevation * (Math.PI / 180);
  return {
    dir: { x: Math.cos(Math.PI * t), y: -Math.sin(Math.PI * t) },
    elevation,
  };
}

// The obstacles that can shade a point within `radius` of center. Obstacles farther than the shade reach can
// never block. A caller that checks many points near one spot gets the casters once and passes them to inShade.
export function shadeCasters(world: World, center: Vec, radius: number): Obstacle[] {
  return shadeCastersAround(world, center, radius);
}

// Whether pos sits in shade: steps toward the sun and checks the terrain and blocking obstacles
// against the ray. `near` must hold every obstacle that can shade pos, and may hold more.
export function inShade(world: World, pos: Vec, sun: Sun, near: Obstacle[] = shadeCasters(world, pos, 0)): boolean {
  const base = heightAt(world.terrain, pos.x, pos.y);
  const rise = Math.tan(sun.elevation);
  for (let i = 1; i <= TIME.shadeSamples; i++) {
    const d = (TIME.shadeReach * i) / TIME.shadeSamples;
    const p = { x: pos.x + sun.dir.x * d, y: pos.y + sun.dir.y * d };
    const rayHeight = base + rise * d;
    if (heightAt(world.terrain, p.x, p.y) > rayHeight) return true;
    if (near.some((o) => obstacleBlocks(world, o, p, rayHeight))) return true;
  }
  return false;
}

// Whether obstacle o covers ray point p and stands above the ray there.
function obstacleBlocks(world: World, o: Obstacle, p: Vec, rayHeight: number): boolean {
  return dist(p, o.pos) <= o.r && propBase(world.terrain, o) + TIME.obstacleShade[o.kind] > rayHeight;
}

// 1 in shade and at night, above 1 in full sun. Weather multiplies the sun-driven share above 1:
// overcast cancels it, a heat wave amplifies it.
export function heatAt(world: World, pos: Vec): number {
  return cappedHeatAt(world, pos, 1);
}

// Whether shade at pos is worth computing. Out of the player's live range, nobody sees it, so ground there is open sun.
export function shadeMatters(world: World, pos: Vec): boolean {
  return !isCheapMeeting(world, pos, pos);
}

// Heat at pos with the sun height share capped at `cap`, so a high sun heats like a lower one.
export function cappedHeatAt(world: World, pos: Vec, cap: number): number {
  const sun = sunAt(world.turn);
  if (!sun || (shadeMatters(world, pos) && inShade(world, pos, sun))) return 1;
  return heatOfShare(world, pos, Math.min(cap, sunShare(sun)));
}

// Heat at pos if it stands in the sun. For callers that already know pos is not in shade.
export function sunHeatAt(world: World, pos: Vec, sun: Sun): number {
  return heatOfShare(world, pos, sunShare(sun));
}

// The sun height as a share of its noon height, 0 to 1.
function sunShare(sun: Sun): number {
  return clamp(sun.elevation / (TIME.noonElevation * (Math.PI / 180)), 0, 1);
}

function heatOfShare(world: World, pos: Vec, t: number): number {
  const excess = (TIME.sunHeat - 1) * t;
  return 1 + excess * weatherAt(world, pos).heat;
}
