// Debug console: Backquote or § opens a command line that runs cheat commands on the live world.
// The command table parses typed text into arguments for the sim cheats. Every user-input problem
// throws CheatError, so the console can tell it from a bug.

import {
  CheatError,
  addXp,
  damagePartTo,
  give,
  grantPerk,
  killVehicles,
  makeHostile,
  noclipMove,
  nearbyVehicles,
  placeSpot,
  randomKit,
  repairAll,
  revealMap,
  setFuel,
  setHealth,
  setMoney,
  setSupplies,
  skipToHour,
  spawnNear,
  startBattle,
  startWeather,
  teleport,
  toggleFrozen,
  toggleFullLog,
  toggleGod,
} from "../sim/cheats";
import { PERKS, SKILL_IDS, XP_RULES } from "../data/skills";
import { playerVehicle } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import { partDef } from "../data/parts";
import { xpTodayOf } from "../sim/progress";
import { dist } from "../sim/vec";
import type { World, XpSource } from "../sim/types";
import { el, panel } from "./dom";

// `toggleFps` asks the console to show or hide the frame rate panel, and `noclip` to switch noclip flight.
// Both live outside the world.
export type CommandResult = { world: World | null; lines: string[]; toggleFps?: true; noclip?: true };

export type Command = {
  name: string;
  usage: string;
  help: string;
  run(world: World, args: string[]): CommandResult;
};

// Builds a command whose name is the first word of its usage line and whose argument count is checked before `run`.
function command(
  usage: string,
  help: string,
  argCount: { min: number; max: number },
  run: (world: World, args: string[], usage: string) => CommandResult,
): Command {
  return {
    name: usage.split(" ")[0],
    usage,
    help,
    run(world, args) {
      if (args.length < argCount.min || args.length > argCount.max) {
        throw new CheatError(`expected ${countText(argCount)}, got ${args.length}. Usage: ${usage}`);
      }
      return run(world, args, usage);
    },
  };
}

function countText({ min, max }: { min: number; max: number }): string {
  if (min === max) return `${min} argument${min === 1 ? "" : "s"}`;
  return `${min} to ${max} arguments`;
}

function parseNumber(text: string, usage: string): number {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n)) {
    throw new CheatError(`"${text}" is not a number. Usage: ${usage}`);
  }
  return n;
}

function changed(world: World, line: string): CommandResult {
  return { world, lines: [line] };
}

// A command that sets one number through a sim cheat.
function setter(name: string, help: string, set: (world: World, n: number) => World, verb = "set to"): Command {
  return command(`${name} <n>`, help, { min: 1, max: 1 }, (world, [text], usage) => {
    const n = parseNumber(text, usage);
    return changed(set(world, n), `${name} ${verb} ${n}`);
  });
}

export const COMMANDS: readonly Command[] = [
  setter("money", "Set money.", setMoney),
  setter("fuel", "Set fuel, capped by the tanks.", setFuel),
  setter("supplies", "Set supplies, capped by the storage.", setSupplies),
  setter("health", "Set driver health.", setHealth),
  command("xp <n>", "Add XP to the pool to spend on ranks.", { min: 1, max: 1 }, (world, [text], usage) => {
    const n = parseNumber(text, usage);
    return changed(addXp(world, n), `XP added: ${n}`);
  }),
  command("perk <perk id>", "Grant a perk at any skill rank.", { min: 1, max: 1 }, (world, [id]) => {
    const next = grantPerk(world, id);
    const granted = next.player.perks[next.player.perks.length - 1];
    return changed(next, `perk granted: ${PERKS[granted].name}`);
  }),
  command("skills", "Show the XP pool, skill ranks, today's XP per activity and XP per source.", { min: 0, max: 0 }, (world) => ({
    world: null,
    lines: skillLines(world),
  })),

  command("repair", "Restore every part to full.", { min: 0, max: 0 }, (world) =>
    changed(repairAll(world), "all parts repaired"),
  ),
  command("damage <part def> <hp>", "Set a mounted part's hit points.", { min: 2, max: 2 }, (world, [defId, hpText], usage) => {
    const hp = parseNumber(hpText, usage);
    return changed(damagePartTo(world, defId, hp), `${defId} set to ${hp} hp`);
  }),
  command("give <part or good id> [count]", "Add a part or goods to the truck.", { min: 1, max: 2 }, (world, [id, countArg], usage) => {
    const count = countArg === undefined ? 1 : parseNumber(countArg, usage);
    return changed(give(world, id, count), `gave ${count} ${id}`);
  }),
  command("god", "Toggle god mode.", { min: 0, max: 0 }, (world) => {
    const next = toggleGod(world);
    return changed(next, `god mode ${next.player.god ? "on" : "off"}`);
  }),
  command("log", "Toggle the full log with events you cannot see or hear.", { min: 0, max: 0 }, (world) => {
    const next = toggleFullLog(world);
    return changed(next, `full log ${next.player.fullLog ? "on" : "off"}`);
  }),
  command("freeze", "Toggle frozen NPCs: no driver, so they roll free, hold fire, use no utilities and raise no radio calls.", { min: 0, max: 0 }, (world) => {
    const next = toggleFrozen(world);
    return changed(next, `NPCs ${next.player.frozen ? "frozen" : "unfrozen"}`);
  }),

  command("fps", "Toggle the frame rate panel.", { min: 0, max: 0 }, () => ({ world: null, lines: [], toggleFps: true })),

  command("tp <location id> | tp <x> <y>", "Move the truck to a location or map point.", { min: 1, max: 2 }, (world, args, usage) => {
    if (args.length === 1) return changed(teleport(world, placeSpot(world, args[0])), `teleported to ${args[0]}`);
    const target = { x: parseNumber(args[0], usage), y: parseNumber(args[1], usage) };
    return changed(teleport(world, target), `teleported to ${target.x}, ${target.y}`);
  }),
  command("hour <h>", "Advance to the next turn at that hour.", { min: 1, max: 1 }, (world, [text], usage) => {
    const hour = parseNumber(text, usage);
    return changed(skipToHour(world, hour), `skipped to hour ${hour}`);
  }),
  command("weather <storm|heatwave|overcast>", "Start that weather.", { min: 1, max: 1 }, (world, [kind]) =>
    changed(startWeather(world, kind), `${kind} started`),
  ),
  command("reveal", "Mark the whole map explored.", { min: 0, max: 0 }, (world) =>
    changed(revealMap(world), "map revealed"),
  ),

  command("spawn <template id> [hostile]", "Place an NPC near the truck.", { min: 1, max: 2 }, (world, [templateId, flag], usage) => {
    if (flag !== undefined && flag !== "hostile") {
      throw new CheatError(`"${flag}" is not a spawn option. The only option is: hostile. Usage: ${usage}`);
    }
    const hostile = flag === "hostile";
    return changed(spawnNear(world, templateId, hostile), `spawned ${hostile ? "hostile " : ""}${templateId}`);
  }),
  command("randomkit [level 1-5]", "Swap the truck for a random NPC truck at a gear level from 1 poor to 5 loaded, or a random level.", { min: 0, max: 1 }, (world, [level]) => {
    const next = randomKit(world, level === undefined ? null : Number(level));
    const me = next.vehicles.find((v) => v.id === next.player.vehicleId)!;
    return changed(next, `randomkit: ${me.chassisId} with ${mountedParts(me).filter((p) => partDef(p.defId).kind !== 'core').map((p) => partDef(p.defId).name).join(', ')}`);
  }),
  command("battle", "Place a random hostile NPC of any kind near the truck.", { min: 0, max: 0 }, (world) => {
    const next = startBattle(world);
    return changed(next, `battle: ${next.vehicles[next.vehicles.length - 1].name} is hostile`);
  }),
  command("hostile <vehicle id>", "Make a vehicle hostile to the player.", { min: 1, max: 1 }, (world, [id]) =>
    changed(makeHostile(world, id), `${id} is hostile`),
  ),
  command("kill <vehicle id|hostiles|all>", "Destroy vehicles.", { min: 1, max: 1 }, (world, [target]) =>
    changed(killVehicles(world, target), `killed ${target}`),
  ),
  command("list", "List nearby vehicles, nearest first.", { min: 0, max: 0 }, (world) => {
    const rows = nearbyVehicles(world);
    if (rows.length === 0) return { world: null, lines: ["no vehicles nearby"] };
    const lines = rows.map(
      (r) => `${r.id}  ${r.name}  ${r.templateId ?? "-"}  ${r.faction}  ${Math.round(r.distance)} tiles${r.hostile ? "  hostile" : ""}`,
    );
    return { world: null, lines };
  }),

  command("noclip", "Fly the truck with WASD at the view center, through obstacles. Again to land.", { min: 0, max: 0 }, () => ({
    world: null,
    lines: [],
    noclip: true,
  })),

  command("help", "List every command.", { min: 0, max: 0 }, () => ({
    world: null,
    lines: COMMANDS.map((c) => `${c.usage}  ${c.help}`),
  })),
];

function skillLines(world: World): string[] {
  const p = world.player;
  const skills = SKILL_IDS.map(
    (id) => `${id}  rank ${p.ranks[id]}  today ${Math.round(xpTodayOf(world, id))}/${XP_RULES.dailyCap}`,
  );
  const sources = (Object.keys(p.xpBySource) as XpSource[]).map((s) => `${s}  ${Math.round(p.xpBySource[s])} xp`);
  return [`pool  ${Math.floor(p.xp)} xp`, ...skills, ...sources];
}

export function runCommand(world: World, line: string): CommandResult {
  const [name, ...args] = line.trim().split(/\s+/);
  if (name === "") throw new CheatError("empty command. Type help for the command list.");
  const cmd = COMMANDS.find((c) => c.name === name.toLowerCase());
  if (!cmd) throw new CheatError(`unknown command "${name}". Type help for the command list.`);
  return cmd.run(world, args);
}

// Keeps the DOM small while still holding a full help listing and a few list outputs.
const LOG_LINES = 200;
const HINT = "type help for commands";
const WAIT = "a turn is playing, try again when it ends";

export type ConsoleGame = {
  readonly state: World;
  readonly busy: boolean;
  apply(w: World): void;
};

// The view parts noclip flight drives: the ground point at the view center in meters, and the key pan speed.
export type NoclipView = {
  focus(): { x: number; z: number };
  setSpeed(factor: number): void;
};

// Noclip pans this many times faster than normal key panning, so crossing the map takes seconds.
const NOCLIP_PAN_SPEED = 4;
// Tiles the view center must move before the flying truck follows, so a still view changes no world.
const NOCLIP_STEP = 0.05;

// Noclip flight: WASD pans the view fast and the truck follows the view center through obstacles, once
// per frame. Landing moves the truck to the nearest free spot.
export class Noclip {
  private on = false;

  constructor(
    private readonly game: ConsoleGame,
    private readonly view: NoclipView,
    private readonly metersPerTile: number,
  ) {
    const frame = (): void => {
      this.fly();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Returns whether flight is now on. Throws CheatError when the truck cannot land.
  toggle(): boolean {
    if (this.on) this.game.apply(teleport(this.game.state, playerVehicle(this.game.state).pos));
    this.on = !this.on;
    this.view.setSpeed(this.on ? NOCLIP_PAN_SPEED : 1);
    return this.on;
  }

  private fly(): void {
    if (!this.on || this.game.busy) return;
    const focus = this.view.focus();
    const target = { x: focus.x / this.metersPerTile, y: focus.z / this.metersPerTile };
    if (dist(target, playerVehicle(this.game.state).pos) > NOCLIP_STEP) this.game.apply(noclipMove(this.game.state, target));
  }
}

// The backquote key, or § by its character, since Mac ISO keyboards report that key under another code.
function isToggleKey(e: KeyboardEvent): boolean {
  return e.code === "Backquote" || e.key === "§";
}

export class DebugConsole {
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly history: string[] = [];
  private cursor = 0; // history index shown in the input; history.length is the fresh line

  constructor(
    host: HTMLElement,
    private readonly game: ConsoleGame,
    private readonly fps: { toggle(): boolean },
    private readonly noclip: Noclip,
  ) {
    this.root = panel("debug-console", host);
    this.root.hidden = true;
    this.log = el("div", { class: "debug-console-log" });
    this.input = document.createElement("input");
    this.input.className = "debug-console-input";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";
    this.root.append(this.log, this.input);
    this.input.addEventListener("keydown", (e) => this.onInputKey(e));
    window.addEventListener("keydown", (e) => this.onWindowKey(e));
  }

  private onWindowKey(e: KeyboardEvent): void {
    if (!isToggleKey(e) || !this.root.hidden) return;
    if (document.activeElement?.matches("input, select, textarea")) return;
    // Without this the keystroke types a backquote into the input focused below.
    e.preventDefault();
    this.open();
  }

  // Keys typed in the console never reach the game's window key handler.
  private onInputKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (isToggleKey(e) || e.code === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.code === "Enter") {
      this.submit();
    } else if (e.code === "ArrowUp") {
      e.preventDefault();
      this.showHistory(this.cursor - 1);
    } else if (e.code === "ArrowDown") {
      e.preventDefault();
      this.showHistory(this.cursor + 1);
    }
  }

  private open(): void {
    this.root.hidden = false;
    if (this.log.childElementCount === 0) this.print(HINT, "dim");
    this.input.focus();
  }

  private close(): void {
    this.root.hidden = true;
    this.input.blur();
  }

  private showHistory(index: number): void {
    if (index < 0 || index > this.history.length) return;
    this.cursor = index;
    this.input.value = index === this.history.length ? "" : this.history[index];
  }

  private submit(): void {
    const line = this.input.value.trim();
    if (line === "") return;
    this.input.value = "";
    this.history.push(line);
    this.cursor = this.history.length;
    this.print(`> ${line}`, "dim");
    if (this.game.busy) {
      this.print(WAIT, "dim");
      return;
    }
    const result = this.run(line);
    if (result !== null) this.show(result);
  }

  private show(result: CommandResult): void {
    if (result.world !== null) this.game.apply(result.world);
    if (result.toggleFps) this.print(`fps panel ${this.fps.toggle() ? "on" : "off"}`);
    for (const text of result.lines) this.print(text);
  }

  // Only bad user input is printed. Any other error is a bug and goes to the crash screen, or to this log outside dev.
  private run(line: string): CommandResult | null {
    try {
      const result = runCommand(this.game.state, line);
      if (!result.noclip) return result;
      return { world: null, lines: [this.noclip.toggle() ? "noclip on: WASD flies the truck" : "noclip off"] };
    } catch (err) {
      if (!(err instanceof CheatError)) throw err;
      this.print(err.message, "bad");
      return null;
    }
  }

  // An error the game kept running past, outside dev.
  error(text: string): void {
    this.print(text, "bad");
  }

  private print(text: string, cls?: "dim" | "bad"): void {
    this.log.append(el("div", { class: cls }, text));
    while (this.log.children.length > LOG_LINES) this.log.children[0].remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
