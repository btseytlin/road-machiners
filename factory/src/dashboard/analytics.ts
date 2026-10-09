/** Runs one SQL file per dashboard panel over the ledger, in an in-memory DuckDB.
 * A panel's failure stays its own: it carries its error text and every other panel keeps its rows. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { vocabularyTables, type DeliveryStage, type Gate, type VocabularyTable } from './vocabulary';

const QUERIES_DIR = join(import.meta.dirname, 'queries');
export const RANGES = [1, 7, 30] as const;
export type Range = typeof RANGES[number];
type Counts = { input: number; output: number; cache_read: number; cache_write: number };

export type PanelRows = {
  problems: { unreadable: number; untimed: number; uncosted: number };
  coverage: { since: string | null; missing_usage: number };
  counters: { worker_ms: number; cost: number | null; input: number | null; output: number | null; cache_read: number | null; cache_write: number | null; wasted_cost: number | null; wasted_input: number | null; wasted_output: number | null; wasted_cache_read: number | null; wasted_cache_write: number | null };
  usage_buckets: { start: string; grouping: 'stage' | 'model'; key: string; cost: number; tokens: number | null };
  stage_time: { stage: string; worker_ms: number };
  waiting: { waiting_ms: number | null; span_ms: number; gaps: number };
  waiting_stages: { stage: string; waiting_ms: number };
  retries: { outcome: string; runs: number; worker_ms: number; cost: number | null };
  stage_models: Counts & { stage: string; model: string; cost: number };
  activity: { stage: string; issue: number | null; outcome: string; at: string };
  delivery_coverage: { since: string | null; issues: number; excluded: number; legacy: number; looped: number };
  lead: { open: number; open_mean_ms: number | null; missing_start: number };
  dwell: { stage: DeliveryStage; count: number; mean_ms: number | null; median_ms: number | null; open: number; open_mean_ms: number | null };
  loops: { step: string; events: number; issues: number };
  rejections: { gate: Gate; decided: number; rejected: number };
  delivery_retries: { stage: string; runs: number; issues: number };
};
export type PanelName = keyof PanelRows;
const PANEL_COLUMNS: { [K in PanelName]: (keyof PanelRows[K])[] } = {
  problems: ['unreadable', 'untimed', 'uncosted'],
  coverage: ['since', 'missing_usage'],
  counters: ['worker_ms', 'cost', 'input', 'output', 'cache_read', 'cache_write', 'wasted_cost', 'wasted_input', 'wasted_output', 'wasted_cache_read', 'wasted_cache_write'],
  usage_buckets: ['start', 'grouping', 'key', 'cost', 'tokens'],
  stage_time: ['stage', 'worker_ms'],
  waiting: ['waiting_ms', 'span_ms', 'gaps'],
  waiting_stages: ['stage', 'waiting_ms'],
  retries: ['outcome', 'runs', 'worker_ms', 'cost'],
  stage_models: ['stage', 'model', 'input', 'output', 'cache_read', 'cache_write', 'cost'],
  activity: ['stage', 'issue', 'outcome', 'at'],
  delivery_coverage: ['since', 'issues', 'excluded', 'legacy', 'looped'],
  lead: ['open', 'open_mean_ms', 'missing_start'],
  dwell: ['stage', 'count', 'mean_ms', 'median_ms', 'open', 'open_mean_ms'],
  loops: ['step', 'events', 'issues'],
  rejections: ['gate', 'decided', 'rejected'],
  delivery_retries: ['stage', 'runs', 'issues'],
};
export type PanelResult<R> = { error: null; ranges: Record<Range, R[]> } | { error: string; ranges: null };
export type Analytics = { [K in PanelName]: PanelResult<PanelRows[K]> };
export type QueryParams = { now: number; days: number; budget_ms: number };

function readQuery(name: string): string { return readFileSync(join(QUERIES_DIR, `${name}.sql`), 'utf8'); }
function quoteText(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function quoteCell(value: string | number | null): string { return value === null ? 'NULL' : typeof value === 'number' ? String(value) : quoteText(value); }
function createTableSql(table: VocabularyTable): string {
  const values = table.rows.map((row) => `(${row.map(quoteCell).join(', ')})`).join(', ');
  return `create table ${table.name} as select * from (values ${values}) as t(${table.columns.join(', ')});`;
}
function readErrorKind(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return /^([A-Z][A-Za-z ]* Error):/.exec(text)?.[1] ?? 'Query error';
}
function toPlain(value: unknown): unknown {
  if (typeof value !== 'bigint') return value;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`Integer ${value} exceeds the safe range`);
  return Number(value);
}
function pickParams(sql: string, params: QueryParams): Partial<QueryParams> {
  const used = new Set([...sql.matchAll(/\$(\w+)/g)].map((match) => match[1]));
  for (const name of used) if (!(name in params)) throw new Error(`Query uses unknown parameter $${name}`);
  return Object.fromEntries(Object.entries(params).filter(([name]) => used.has(name)));
}
function checkColumns(name: PanelName, columns: string[]): void {
  const expected = PANEL_COLUMNS[name] as string[];
  if (columns.length !== expected.length || expected.some((column) => !columns.includes(column))) throw new Error(`Panel ${name} returned columns ${columns.join(', ')}; expected ${expected.join(', ')}`);
}

export class AnalyticsRunner {
  private constructor(private readonly connection: DuckDBConnection) {}
  static async open(): Promise<AnalyticsRunner> {
    const instance = await DuckDBInstance.create(':memory:', { autoinstall_known_extensions: 'false', autoload_known_extensions: 'false' });
    const connection = await instance.connect();
    await connection.run(`set TimeZone = 'UTC'`);
    for (const table of vocabularyTables()) await connection.run(createTableSql(table));
    await connection.run(`create table lines (line bigint, l varchar)`);
    await connection.run(readQuery('base'));
    await connection.run(readQuery('macros'));
    return new AnalyticsRunner(connection);
  }
  async read(ledgerPath: string, now: Date, budgetMs: number): Promise<Analytics> {
    await this.load(ledgerPath);
    const results: Partial<Record<PanelName, PanelResult<unknown>>> = {};
    for (const name of Object.keys(PANEL_COLUMNS) as PanelName[]) results[name] = await this.runPanel(name, now.getTime(), budgetMs);
    return results as Analytics;
  }
  private async load(ledgerPath: string): Promise<void> {
    if (!existsSync(ledgerPath)) throw new Error(`Ledger missing at ${ledgerPath}`);
    await this.connection.run(`create or replace table lines as select row_number() over () as line, l from read_csv(${quoteText(ledgerPath)}, columns = {'l': 'VARCHAR'}, delim = E'\\x1e', quote = '', escape = '', header = false, auto_detect = false)`);
    await this.connection.run(readQuery('base'));
  }
  private async runPanel(name: PanelName, now: number, budgetMs: number): Promise<PanelResult<unknown>> {
    try {
      const sql = readQuery(name);
      const ranges: Partial<Record<Range, unknown[]>> = {};
      for (const days of RANGES) ranges[days] = await this.query(name, sql, { now, days, budget_ms: budgetMs });
      return { error: null, ranges: ranges as Record<Range, unknown[]> };
    } catch (error) {
      console.error(`Dashboard panel ${name} failed:`, error);
      return { error: readErrorKind(error), ranges: null };
    }
  }
  private async query(name: PanelName, sql: string, params: QueryParams): Promise<unknown[]> {
    const reader = await this.connection.runAndReadAll(sql, pickParams(sql, params));
    checkColumns(name, reader.columnNames());
    return reader.getRowObjectsJS().map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toPlain(value)])));
  }
}
