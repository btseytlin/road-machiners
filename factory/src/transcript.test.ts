import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { transcriptUsage } from './transcript';

const PROJECTS = resolve('tmp/factory-transcript-test');
const PRICES = { opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 }, haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 } };

type Usage = { input?: number; output?: number; cacheRead?: number; write5m?: number; write1h?: number };
const message = (id: string, model: string, usage: Usage, timestamp: string | null = '2026-10-05T10:00:00.000Z'): string => JSON.stringify({
  type: 'assistant',
  timestamp,
  message: { id, model, usage: { input_tokens: usage.input ?? 0, output_tokens: usage.output ?? 0, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: (usage.write5m ?? 0) + (usage.write1h ?? 0), cache_creation: { ephemeral_5m_input_tokens: usage.write5m ?? 0, ephemeral_1h_input_tokens: usage.write1h ?? 0 } } },
});
const write = (path: string, lines: string[]): void => writeFileSync(`${PROJECTS}/${path}`, `${lines.join('\n')}\n`);

beforeEach(() => {
  rmSync(PROJECTS, { recursive: true, force: true });
  mkdirSync(`${PROJECTS}/-work-game/s1/subagents`, { recursive: true });
});

describe('transcriptUsage', () => {
  it('counts each message once, adds subagents and prices 5-minute and 1-hour cache writes apart', () => {
    const first = message('m1', 'opus', { input: 10, output: 1000, cacheRead: 100_000, write1h: 2000 });
    write('-work-game/s1.jsonl', [JSON.stringify({ type: 'user', message: { content: 'hi' } }), first, first, message('m2', 'opus', { output: 500, write5m: 400 })]);
    write('-work-game/s1/subagents/agent-a.jsonl', [message('m3', 'haiku', { input: 5, output: 100, cacheRead: 1000 })]);
    write('-work-game/other.jsonl', [message('m9', 'opus', { output: 1_000_000 })]);
    const usage = transcriptUsage(PROJECTS, 's1', PRICES, new Date(0));
    expect(usage?.map((row) => ({ model: row.model, input: row.input, output: row.output, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite }))).toEqual([
      { model: 'opus', input: 10, output: 1500, cacheRead: 100_000, cacheWrite: 2400 },
      { model: 'haiku', input: 5, output: 100, cacheRead: 1000, cacheWrite: 0 },
    ]);
    expect(usage?.[0].cost).toBeCloseTo((10 * 4 + 1500 * 20 + 100_000 * 0.2 + 400 * 5 + 2000 * 8) / 1e6, 12);
    expect(usage?.[1].cost).toBeCloseTo((5 * 1 + 100 * 5 + 1000 * 0.1) / 1e6, 12);
  });

  it('skips the synthetic replies Claude Code writes for its own errors', () => {
    write('-work-game/s1.jsonl', [message('m1', '<synthetic>', {}), message('m2', 'opus', { output: 10 })]);
    expect(transcriptUsage(PROJECTS, 's1', PRICES, new Date(0))?.map((row) => row.model)).toEqual(['opus']);
  });

  it('is null when Claude Code saved no transcript', () => {
    expect(transcriptUsage(PROJECTS, 'missing', PRICES, new Date(0))).toBeNull();
    expect(transcriptUsage(`${PROJECTS}/none`, 's1', PRICES, new Date(0))).toBeNull();
  });

  it('counts only messages at or after since', () => {
    write('-work-game/s1.jsonl', [message('m1', 'opus', { output: 100 }, '2026-10-05T09:59:59.999Z'), message('m2', 'opus', { output: 10 }, '2026-10-05T10:00:00.000Z'), message('m3', 'opus', { output: 1 }, '2026-10-05T10:05:00.000Z')]);
    expect(transcriptUsage(PROJECTS, 's1', PRICES, new Date('2026-10-05T10:00:00.000Z'))?.map((row) => row.output)).toEqual([11]);
  });

  it('throws on a counted message without a timestamp', () => {
    write('-work-game/s1.jsonl', [message('m1', 'opus', { output: 10 }, null)]);
    expect(() => transcriptUsage(PROJECTS, 's1', PRICES, new Date(0))).toThrow(/Message m1 in .*s1\.jsonl has no valid timestamp/);
  });

  it('throws on a model with no price', () => {
    write('-work-game/s1.jsonl', [message('m1', 'mystery', { output: 10 })]);
    expect(() => transcriptUsage(PROJECTS, 's1', PRICES, new Date(0))).toThrow('mystery, which FACTORY_MODEL_PRICES does not price');
  });
});
