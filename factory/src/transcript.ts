import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelUsage } from './ledger';
import type { TokenPrice } from './types';

function transcriptFiles(projects: string, id: string): string[] {
  if (!existsSync(projects)) return [];
  return readdirSync(projects, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const main = join(projects, entry.name, `${id}.jsonl`);
    if (!existsSync(main)) return [];
    const subagents = join(projects, entry.name, id, 'subagents');
    const children = existsSync(subagents) ? readdirSync(subagents).filter((name) => name.endsWith('.jsonl')).map((name) => join(subagents, name)) : [];
    return [main, ...children];
  });
}

type Counts = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };
type Message = { id: string; model: string; usage: Record<string, unknown>; timestamp: unknown };

const count = (value: unknown, at: string): number => {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${at} has an invalid token count`);
  return value;
};

function readMessages(file: string): Message[] {
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').flatMap((line) => {
    const event = JSON.parse(line) as { type?: string; timestamp?: unknown; message?: { id?: string; model?: string; usage?: Record<string, unknown> } };
    const message = event.message;
    if (event.type !== 'assistant' || !message?.id || !message.model || !message.usage) return [];
    return [{ id: message.id, model: message.model, usage: message.usage, timestamp: event.timestamp }];
  });
}

function countsOf(message: Message, at: string): Counts {
  const usage = message.usage;
  const written = count(usage.cache_creation_input_tokens, at);
  const split = (usage.cache_creation ?? null) as Record<string, unknown> | null;
  const cacheWrite5m = count(split?.ephemeral_5m_input_tokens, at);
  const cacheWrite1h = count(split?.ephemeral_1h_input_tokens, at);
  if (cacheWrite5m + cacheWrite1h !== written) throw new Error(`${at} splits ${written} cache write tokens into ${cacheWrite5m} 5-minute and ${cacheWrite1h} 1-hour tokens`);
  return { input: count(usage.input_tokens, at), output: count(usage.output_tokens, at), cacheRead: count(usage.cache_read_input_tokens, at), cacheWrite5m, cacheWrite1h };
}

const priceOf = (counts: Counts, price: TokenPrice): number =>
  (counts.input * price.input + counts.output * price.output + counts.cacheRead * price.cacheRead + counts.cacheWrite5m * price.cacheWrite5m + counts.cacheWrite1h * price.cacheWrite1h) / 1_000_000;

function readTime(message: Message, at: string): number {
  const time = typeof message.timestamp === 'string' ? Date.parse(message.timestamp) : Number.NaN;
  if (Number.isNaN(time)) throw new Error(`${at} has no valid timestamp`);
  return time;
}

export function transcriptUsage(projects: string, id: string, prices: Record<string, TokenPrice>, since: Date): ModelUsage[] | null {
  const files = transcriptFiles(projects, id);
  if (files.length === 0) return null;
  const seen = new Set<string>();
  const models = new Map<string, ModelUsage>();
  const messages = files.flatMap((file) => readMessages(file).map((message) => ({ message, file })));
  for (const { message, file } of messages.filter(({ message }) => message.model !== '<synthetic>')) {
    const at = `Message ${message.id} in ${file}`;
    if (readTime(message, at) < since.getTime() || seen.has(message.id)) continue;
    seen.add(message.id);
    addMessage(models, message, at, prices);
  }
  return [...models.values()];
}

function addMessage(models: Map<string, ModelUsage>, message: Message, at: string, prices: Record<string, TokenPrice>): void {
  const price = prices[message.model];
  if (!price) throw new Error(`${at} ran on ${message.model}, which FACTORY_MODEL_PRICES does not price`);
  const counts = countsOf(message, at);
  const row = models.get(message.model) ?? { model: message.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  row.input += counts.input;
  row.output += counts.output;
  row.cacheRead += counts.cacheRead;
  row.cacheWrite += counts.cacheWrite5m + counts.cacheWrite1h;
  row.cost += priceOf(counts, price);
  models.set(message.model, row);
}
