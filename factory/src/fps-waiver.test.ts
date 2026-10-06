import { describe, expect, it } from 'vitest';
import { judgeFpsWaiver, waiverNotice } from './fps-waiver';

const PREAMBLE = '\n> roam@0.1.0 playtest\n> node scripts/playtest.mjs\n\n';
const soleFps = (fps = '44.5') => `${PREAMBLE}turns 12, fps ${fps}\nFAIL\nfps ${fps} under 50\n`;

describe('judgeFpsWaiver', () => {
  it('accepts a full 12-turn playtest whose only problem is the frame rate', () => {
    expect(judgeFpsWaiver(soleFps(), 1)).toEqual({ fps: 44.5 });
    expect(judgeFpsWaiver(soleFps('24'), 1)).toEqual({ fps: 24 });
  });

  it('ignores the npm error trailer and carriage returns', () => {
    const output = `${soleFps()}npm error Lifecycle script \`playtest\` failed with error:\nnpm error code 1\nnpm ERR! path /work/game\n`.replaceAll('\n', '\r\n');
    expect(judgeFpsWaiver(output, 1)).toEqual({ fps: 44.5 });
  });

  it('rejects an FPS failure mixed with any other problem', () => {
    for (const other of ['crash screen shown', 'no WebGL canvas', 'expected turn 13, got 9', 'TypeError: x is undefined\n    at tick (main.ts:3)']) {
      expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\nFAIL\n${other}\nfps 44.5 under 50\n`, 1)).toHaveProperty('reason');
    }
  });

  it('rejects a playtest with a problem other than the frame rate', () => {
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 60\nFAIL\nno WebGL canvas\n`, 1)).toHaveProperty('reason');
  });

  it('rejects a playtest that died before its result, like a turn timeout', () => {
    const output = `${PREAMBLE}file:///work/game/scripts/playtest.mjs:45\nError: Turn 3 did not finish playing within 10000 ms\n`;
    expect(judgeFpsWaiver(output, 1)).toEqual({ reason: 'the playtest printed no single "turns N, fps X" result' });
  });

  it('rejects missing or malformed output', () => {
    expect(judgeFpsWaiver('', 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\n`, 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps abc\nFAIL\nfps abc under 50\n`, 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\nturns 12, fps 44.5\nFAIL\nfps 44.5 under 50\n`, 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\nFAIL\nFAIL\nfps 44.5 under 50\n`, 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\nFAIL\n`, 1)).toHaveProperty('reason');
  });

  it('rejects output it cannot place, before or after the result', () => {
    expect(judgeFpsWaiver(`${PREAMBLE}something odd\nturns 12, fps 44.5\nFAIL\nfps 44.5 under 50\n`, 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\nsomething odd\nFAIL\nfps 44.5 under 50\n`, 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${soleFps()}PASS\n`, 1)).toHaveProperty('reason');
  });

  it('rejects fewer turns, as the --cpu playtest plays', () => {
    expect(judgeFpsWaiver(`${PREAMBLE}turns 4, fps 1.5\nFAIL\nfps 1.5 under 50\n`, 1)).toHaveProperty('reason');
  });

  it('rejects a frame rate line that disagrees with the result or is not under 50', () => {
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\nFAIL\nfps 40 under 50\n`, 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(soleFps('50'), 1)).toHaveProperty('reason');
    expect(judgeFpsWaiver(`${PREAMBLE}turns 12, fps 44.5\nFAIL\nfps 44.5 under 40\n`, 1)).toHaveProperty('reason');
  });

  it('rejects any exit code but 1', () => {
    expect(judgeFpsWaiver(soleFps(), 0)).toHaveProperty('reason');
    expect(judgeFpsWaiver(soleFps(), 137)).toHaveProperty('reason');
    expect(judgeFpsWaiver(soleFps(), Number.NaN)).toHaveProperty('reason');
  });
});

describe('waiverNotice', () => {
  it('names the label, the measured frame rate and the gate', () => {
    expect(waiverNotice(44.5)).toBe('⚠️ FPS gate waived by the fps-waived label. The GPU playtest measured 44.5 fps, under the 50 fps gate. Every other check passed.');
  });
});
