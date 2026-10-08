// Time of day and the sun. Pure functions of the turn number.

import { TIME } from "../data/time";
import { weatherAt } from "./weather";
import type { Obstacle, World } from "./types";
import { heightAt } from "./terrain";
import { clamp, dist, type Vec } from "./vec";

export type Sun = { dir: Vec; elevation: number };

export function clockOf(turn: number): { day: number; hour: number } {
  const hours = TIME.startHour + ((turn - 1) * 24) / TIME.turnsPerDay;
  return { day: Math.floor(hours / 24) + 1, hour: hours % 24 };
}

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

export function shadeCasters(world: World, center: Vec, radius: number): Obstacle[] {
  return world.obstacles.filter((o) => TIME.obstacleShade[o.kind] !== undefined && dist(center, o.pos) <= radius + TIME.shadeReach + o.r);
}

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

function obstacleBlocks(world: World, o: Obstacle, p: Vec, rayHeight: number): boolean {
  return dist(p, o.pos) <= o.r && heightAt(world.terrain, o.pos.x, o.pos.y) + TIME.obstacleShade[o.kind] > rayHeight;
}

export function heatAt(world: World, pos: Vec): number {
  return cappedHeatAt(world, pos, 1);
}

export function cappedHeatAt(world: World, pos: Vec, cap: number): number {
  const sun = sunAt(world.turn);
  if (!sun || inShade(world, pos, sun)) return 1;
  return heatOfShare(world, pos, Math.min(cap, sunShare(sun)));
}

export function sunHeatAt(world: World, pos: Vec, sun: Sun): number {
  return heatOfShare(world, pos, sunShare(sun));
}

function sunShare(sun: Sun): number {
  return clamp(sun.elevation / (TIME.noonElevation * (Math.PI / 180)), 0, 1);
}

function heatOfShare(world: World, pos: Vec, t: number): number {
  const excess = (TIME.sunHeat - 1) * t;
  return 1 + excess * weatherAt(world, pos).heat;
}
