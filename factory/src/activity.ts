import { parseAgentStatus, reportObservation, type Activity, type ActivityData, type Milestone } from './observability';
import type { Run } from './types';

type StreamBlock = { type?: string; name?: string; input?: { command?: string }; content?: unknown };
type StreamEvent = { type?: string; message?: { content?: StreamBlock[] } };
type ActivityUpdate = ({ activity: Activity } | { milestone: Milestone }) & { source: ActivityData['source'] };
const CHECK_STEPS: Record<string, Activity> = { 'npm ci': 'install', 'tests and typecheck': 'tests', 'tests done': 'typecheck', 'dev server': 'starting', playtest: 'playtest', build: 'build', done: 'finished' };
const TOOL_ACTIVITIES: Record<string, Activity> = { Read: 'reading', Glob: 'reading', Grep: 'reading', Edit: 'editing', Write: 'editing', Agent: 'model', Task: 'model' };
function classifyCommand(command: string): Activity {
  if (/\bnpm (?:run )?(?:test|test:)/.test(command)) return 'tests';
  if (/\bnpm run typecheck\b/.test(command)) return 'typecheck';
  if (/\bnpm run build\b/.test(command)) return 'build';
  if (/\bnpm (?:ci|install)\b/.test(command)) return 'install';
  if (/\bgit\b/.test(command)) return 'git';
  return 'command';
}
function readToolActivity(block: StreamBlock): ActivityUpdate | null {
  if (block.type === 'tool_result') return readToolResultActivity(block.content);
  if (block.type !== 'tool_use') return null;
  if (block.name === 'Bash') return { activity: classifyToolCommand(block), source: 'runner' };
  return { activity: TOOL_ACTIVITIES[block.name ?? ''] ?? 'command', source: 'runner' };
}
function classifyToolCommand(block: StreamBlock): Activity { return classifyCommand(block.input?.command ?? ''); }
function readToolResultActivity(content: unknown): ActivityUpdate {
  const text = typeof content === 'string' ? content : Array.isArray(content) && content.every((block) => block?.type === 'text' && typeof block.text === 'string')
    ? content.map((block) => block.text).join('') : null;
  const reported = text === null ? null : readReportedStatus(text);
  return reported ? { ...reported, source: 'agent' } : { activity: 'model', source: 'runner' };
}
function readReportedStatus(text: string): ReturnType<typeof parseAgentStatus> {
  const reports = text.split('\n').map((line) => parseAgentStatus(line.trim())).filter((report) => report !== null);
  return reports.filter((report) => 'milestone' in report).at(-1) ?? reports.at(-1) ?? null;
}
function readStreamActivity(event: StreamEvent): ActivityUpdate | null {
  if (event.type === 'result') return { activity: 'finished', source: 'runner' };
  const blocks = event.message?.content;
  if (!Array.isArray(blocks)) return null;
  return blocks.map(readToolActivity).find((value) => value !== null) ?? null;
}
export function readActivityLine(line: string): ActivityUpdate | null {
  const step = /^\[checks\] \S+ (.+)$/.exec(line);
  if (step) return CHECK_STEPS[step[1]] ? { activity: CHECK_STEPS[step[1]], source: 'runner' } : null;
  const reported = parseAgentStatus(line);
  if (reported) return { ...reported, source: 'agent' };
  try { return readStreamActivity(JSON.parse(line) as StreamEvent); } catch { return null; }
}
function identifyOperation(command: string, args: string[]): Activity {
  if (args.includes('factory-agent')) return 'model';
  if (command === 'git' || command === 'gh') return 'git';
  return classifyCommand([command, ...args].join(' '));
}

export class ActivityReporter {
  private active = new Map<symbol, { activity: Activity; source: ActivityData['source'] }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private progressAt: string | null = null;
  private milestone: Milestone | null = null;
  constructor(private readonly home: string, private readonly producer: string, private readonly heartbeatMs: number) {
    if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) throw new Error('Invalid observation heartbeat interval');
  }
  private publish(activity: Activity, phase: ActivityData['phase'], source: ActivityData['source']): void {
    reportObservation(this.home, this.producer, { type: 'activity', activity, phase, source, progressAt: this.progressAt, ...(this.milestone === null ? {} : { milestone: this.milestone }) });
  }
  private heartbeat(): void {
    const current = [...this.active.values()].at(-1);
    if (current) this.publish(current.activity, 'running', current.source);
  }
  start(activity: Activity): symbol {
    const key = Symbol('operation');
    this.active.set(key, { activity, source: 'runner' });
    this.heartbeat();
    this.timer ??= setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.timer.unref();
    return key;
  }
  update(key: symbol, update: ActivityUpdate): void {
    if ('milestone' in update) this.milestone = update.milestone;
    else {
      if (['finished', 'model'].includes(update.activity) && update.source === 'runner') this.progressAt = new Date().toISOString();
      this.active.set(key, { activity: update.activity, source: update.source });
    }
    this.heartbeat();
  }
  finish(key: symbol, failed: boolean): void {
    const current = this.active.get(key)!;
    this.active.delete(key);
    if (!failed) this.progressAt = new Date().toISOString();
    this.publish(current.activity, failed ? 'failed' : 'completed', 'runner');
    if (this.active.size) return this.heartbeat();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

class ActivityStream {
  private buffer = '';
  private dropping = false;
  constructor(private readonly report: (update: ActivityUpdate) => void, private readonly maxBytes: number) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('Invalid observation event size limit');
  }
  consume(chunk: string): void {
    for (const part of chunk.split(/(?<=\n)/)) this.consumePart(part);
  }
  private consumePart(part: string): void {
    const ended = part.endsWith('\n');
    if (!this.dropping) this.buffer += part;
    if (Buffer.byteLength(this.buffer) > this.maxBytes) this.dropOversize();
    if (!ended) return;
    this.finishLine();
  }
  private dropOversize(): void {
    console.error('Factory activity event exceeded its configured size limit');
    this.buffer = '';
    this.dropping = true;
  }
  private finishLine(): void {
    const update = readActivityLine(this.buffer.trim());
    if (update) this.report(update);
    this.buffer = '';
    this.dropping = false;
  }
}
export function createObservedRun(run: Run, home: string, producer: string, heartbeatMs: number, maxBytes: number): Run {
  const reporter = new ActivityReporter(home, producer, heartbeatMs);
  return async (command, args, opts = {}) => {
    const key = reporter.start(identifyOperation(command, args));
    const stream = new ActivityStream((update) => reporter.update(key, update), maxBytes);
    let failed = true;
    try {
      const result = await run(command, args, { ...opts, onStdout: (chunk) => { stream.consume(chunk); opts.onStdout?.(chunk); } });
      failed = result.code !== 0;
      return result;
    } finally { reporter.finish(key, failed); }
  };
}
