import { describe, expect, it } from "vitest";
import { CheatError } from "../sim/cheats";
import { emptyWorld } from "../sim/testkit";
import { COMMANDS, runCommand } from "./console";

function errorOf(line: string): CheatError {
  try {
    runCommand(emptyWorld(), line);
  } catch (e) {
    if (e instanceof CheatError) return e;
    throw e;
  }
  throw new Error(`"${line}" did not throw`);
}

describe("runCommand dispatch", () => {
  it("applies a state command and confirms it", () => {
    const w = emptyWorld();

    const result = runCommand(w, "money 5000");

    expect(result.world?.player.money).toBe(5000);
    expect(result.lines).toEqual(["money set to 5000"]);
  });

  it("matches the command name without case and tolerates extra spaces", () => {
    const result = runCommand(emptyWorld(), "  MONEY   250 ");

    expect(result.world?.player.money).toBe(250);
  });

  it("leaves the input world unchanged", () => {
    const w = emptyWorld();
    const before = w.player.money;

    runCommand(w, "money 5000");

    expect(w.player.money).toBe(before);
  });

  it("names the unknown command and points at help", () => {
    const e = errorOf("fly 3");

    expect(e.message).toContain("fly");
    expect(e.message).toContain("help");
  });

  it("rejects an empty line", () => {
    expect(() => runCommand(emptyWorld(), "   ")).toThrow(CheatError);
  });
});

describe("argument checks", () => {
  it.each(["money", "money 1 2"])("gives the usage line on a wrong argument count: %s", (line) => {
    expect(errorOf(line).message).toContain("money <n>");
  });

  it.each(["12abc", "abc", "NaN", "Infinity", "1,5"])("rejects the bad number %s by name", (arg) => {
    const e = errorOf(`money ${arg}`);

    expect(e.message).toContain(arg);
    expect(e.message).toContain("money <n>");
  });

  it.each([
    ["0", 0],
    ["2.5", 2.5],
    ["1e1", 10],
  ])("parses the number %s", (arg, value) => {
    expect(runCommand(emptyWorld(), `fuel ${arg}`).world?.player.fuel).toBe(value);
  });

  it("passes a negative number on for the cheat's own range check", () => {
    const e = errorOf("money -3");

    expect(e.message).toContain("-3");
    expect(e.message).not.toContain("is not a number");
  });

  it("allows the optional count of give to be left out but checks it when given", () => {
    expect(errorOf("give scrap x").message).toContain("give <part or good id> [count]");
    expect(errorOf("give").message).toContain("give <part or good id> [count]");
  });

  it("accepts only the literal hostile as the second spawn argument", () => {
    const e = errorOf("spawn raider friendly");

    expect(e.message).toContain("friendly");
    expect(e.message).toContain("hostile");
  });

  it("lists the weather kinds on an unknown kind", () => {
    const e = errorOf("weather snow");

    expect(e.message).toContain("snow");
    expect(e.message).toContain("storm");
    expect(e.message).toContain("heatwave");
    expect(e.message).toContain("overcast");
  });

  it("checks both tp coordinates as numbers", () => {
    expect(errorOf("tp 10 y").message).toContain("tp <location id> | tp <x> <y>");
  });
});

describe("queries", () => {
  it("help lists every command usage and help, one line each", () => {
    const result = runCommand(emptyWorld(), "help");

    expect(result.world).toBeNull();
    expect(result.lines).toHaveLength(COMMANDS.length);
    for (const [i, c] of COMMANDS.entries()) {
      expect(result.lines[i]).toContain(c.usage);
      expect(result.lines[i]).toContain(c.help);
    }
  });

  it("help covers the whole command set", () => {
    expect(COMMANDS.map((c) => c.name).sort()).toEqual(
      [
        "battle",
        "damage",
        "engineheat",
        "fps",
        "fuel",
        "give",
        "god",
        "health",
        "help",
        "hostile",
        "hour",
        "kill",
        "list",
        "log",
        "money",
        "noclip",
        "perk",
        "randomkit",
        "repair",
        "reveal",
        "skills",
        "spawn",
        "supplies",
        "tp",
        "weather",
        "xp",
      ].sort(),
    );
  });

  it("randomkit swaps the truck and names the new chassis", () => {
    const result = runCommand(emptyWorld(), "randomkit");
    const me = result.world!.vehicles.find((v) => v.id === result.world!.player.vehicleId)!;
    expect(result.lines[0]).toContain(`randomkit: ${me.chassisId} with `);
  });

  it("perk grants the perk and names it", () => {
    const result = runCommand(emptyWorld(), "perk paidTruce");
    expect(result.world?.player.perks).toEqual(["paidTruce"]);
    expect(result.lines).toEqual(["perk granted: Paid truce"]);
    expect(() => runCommand(emptyWorld(), "perk flying")).toThrow(CheatError);
  });

  it("list returns no world", () => {
    expect(runCommand(emptyWorld(), "list").world).toBeNull();
  });

  it("god reports the new mode", () => {
    const on = runCommand(emptyWorld(), "god");
    if (!on.world) throw new Error("god returned no world");
    const off = runCommand(on.world, "god");

    expect(on.lines).toEqual(["god mode on"]);
    expect(off.lines).toEqual(["god mode off"]);
  });

  it("log reports the new mode", () => {
    const on = runCommand(emptyWorld(), "log");
    if (!on.world) throw new Error("log returned no world");
    const off = runCommand(on.world, "log");

    expect(on.lines).toEqual(["full log on"]);
    expect(off.lines).toEqual(["full log off"]);
  });
});
