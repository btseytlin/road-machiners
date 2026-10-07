// NPC memory system (issue #147).
// Each NPC keeps an ordered log of what it saw. Hidden from the player, saved
// with the world state. Memories expire after a configurable time (default one
// day). Contradictory memories about the same object: newest overwrites old.

export const DEFAULT_MEMORY_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

export type MemoryKind = 'saw-person' | 'price' | 'generic';

export interface Memory {
  /** Monotonic world time (ms) when the memory was formed. */
  at: number;
  kind: MemoryKind;
  /** What the memory is about: an npc/object id, or 'price:<good>:<place>'. */
  subject: string;
  /** Newest memory about the same subject overwrites the old one. */
  detail: string;
}

export interface NpcMemoryConfig {
  memoryTtlMs: number;
}

export interface NpcMemories {
  [npcId: string]: Memory[];
}

export const DEFAULT_MEMORY_CONFIG: NpcMemoryConfig = { memoryTtlMs: DEFAULT_MEMORY_TTL_MS };

/** Records a memory, overwriting any earlier memory with the same subject. */
export function remember(
  memories: NpcMemories,
  npcId: string,
  memory: Memory,
  config: NpcMemoryConfig = DEFAULT_MEMORY_CONFIG,
): NpcMemories {
  const log = (memories[npcId] ?? []).filter((m) => m.subject !== memory.subject);
  return { ...memories, [npcId]: [...log, memory].slice(-200) };
}

/** Drops memories older than the TTL. Call on world tick or before reading. */
export function expireMemories(
  memories: NpcMemories,
  now: number,
  config: NpcMemoryConfig = DEFAULT_MEMORY_CONFIG,
): NpcMemories {
  const out: NpcMemories = {};
  for (const [npcId, log] of Object.entries(memories)) {
    const kept = log.filter((m) => now - m.at < config.memoryTtlMs);
    if (kept.length > 0) out[npcId] = kept;
  }
  return out;
}

export interface PriceMemoryInput {
  good: string;
  place: string;
  price: number;
  baseValue: number;
  at: number;
}

/** A price is significant when it is at least 25% off its base value. */
export const SIGNIFICANT_PRICE_RATIO = 0.25;

export function priceIsSignificant(price: number, baseValue: number): boolean {
  if (baseValue <= 0) return false;
  return Math.abs(price - baseValue) / baseValue >= SIGNIFICANT_PRICE_RATIO;
}

/** Records a price memory only when the price was significantly off base. */
export function rememberPrice(
  memories: NpcMemories,
  npcId: string,
  input: PriceMemoryInput,
  config: NpcMemoryConfig = DEFAULT_MEMORY_CONFIG,
): NpcMemories {
  if (!priceIsSignificant(input.price, input.baseValue)) return memories;
  return remember(
    memories,
    npcId,
    {
      at: input.at,
      kind: 'price',
      subject: `price:${input.good}:${input.place}`,
      detail: `${input.price}`,
    },
    config,
  );
}

/**
 * Trading tip for "anything interesting?". Returns null when the NPC has no
 * significant price memory. Example: "Last time I was at Bowl, salt was very
 * overpriced."
 */
export function tradingTip(memories: NpcMemories, npcId: string, now: number, config: NpcMemoryConfig = DEFAULT_MEMORY_CONFIG): string | null {
  const log = expireMemories(memories, now, config)[npcId] ?? [];
  const price = log.filter((m) => m.kind === 'price' && m.subject.startsWith('price:')).at(-1);
  if (!price) return null;
  const [, good, place] = price.subject.split(':');
  const value = Number(price.detail);
  const base = Number(price.baseValue ?? NaN);
  const direction = Number.isFinite(base) && value > base ? 'overpriced' : 'cheap';
  return `Last time I was at ${place}, ${good} was very ${direction}.`;
}
