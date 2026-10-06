import { FPS_WAIVED_LABEL } from './types';

// The game's GPU playtest plays 12 turns and fails under 50 fps. The factory never imports game code, so it mirrors both here.
// A game change to either makes every waiver fail, never pass by mistake.
const PLAYTEST_TURNS = 12;
const MIN_FPS = 50;
const NUMBER = String.raw`\d+(?:\.\d+)?`;
const RESULT_LINE = new RegExp(`^turns (\\d+), fps (${NUMBER})$`);
// npm's own lines: the "> script" preamble before the playtest runs, and its error trailer after a failed script.
const PREAMBLE_LINE = /^> /;
const NPM_ERROR_LINE = /^npm (error|ERR!)( |$)/;

export type FpsVerdict = { fps: number } | { reason: string };

type Result = { at: number; turns: number; fps: string };

// Judges a failed GPU playtest on an issue labeled fps-waived. It accepts only a complete run whose one problem is the frame rate.
// Any output it cannot place, like a page error, a crash, a blank canvas, a timeout or a missing result, is a real failure.
export function judgeFpsWaiver(output: string, code: number): FpsVerdict {
  if (code !== 1) return { reason: `the playtest exited with code ${code}, not 1` };
  const lines = output.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line.trim() !== '');
  const result = findResult(lines);
  if ('reason' in result) return result;
  const reason = resultReason(lines, result) ?? problemReason(lines.slice(result.at + 1), result.fps);
  return reason === null ? { fps: Number(result.fps) } : { reason };
}

function findResult(lines: string[]): Result | { reason: string } {
  const at = lines.findIndex((line) => RESULT_LINE.test(line));
  if (at < 0 || lines.slice(at + 1).some((line) => RESULT_LINE.test(line))) return { reason: 'the playtest printed no single "turns N, fps X" result' };
  const [, turns, fps] = RESULT_LINE.exec(lines[at]) ?? [];
  return { at, turns: Number(turns), fps };
}

// The run played every turn, and only npm's preamble came before its result.
function resultReason(lines: string[], result: Result): string | null {
  if (result.turns !== PLAYTEST_TURNS) return `the playtest played ${result.turns} turns, not ${PLAYTEST_TURNS}`;
  if (lines.slice(0, result.at).some((line) => !PREAMBLE_LINE.test(line))) return 'the playtest printed output before its result';
  return null;
}

// After the result comes FAIL and one problem, the frame rate of that same result, under the gate. npm's trailer may follow.
function problemReason(rest: string[], fps: string): string | null {
  const [fail, ...problems] = rest.filter((line) => !NPM_ERROR_LINE.test(line));
  if (fail !== 'FAIL') return 'the playtest result is not followed by FAIL';
  if (problems.length !== 1) return `the playtest reported ${problems.length} problems, and the waiver covers only the frame rate alone`;
  if (problems[0] !== `fps ${fps} under ${MIN_FPS}`) return `the playtest problem "${problems[0]}" is not the frame rate of its result`;
  if (Number(fps) >= MIN_FPS) return `the measured ${fps} fps is not under ${MIN_FPS}`;
  return null;
}

// The waiver shows in the approval post and on the issue, so nobody takes the build for a pass of the frame rate gate.
export function waiverNotice(fps: number): string {
  return `⚠️ FPS gate waived by the ${FPS_WAIVED_LABEL} label. The GPU playtest measured ${fps} fps, under the ${MIN_FPS} fps gate. Every other check passed.`;
}
