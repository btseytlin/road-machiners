// The boot steps and their state. A step moves only when real boot work starts, counts or ends.

import { list, t, type Msg } from '../text/msg';

export type BootStep = 'code' | 'map' | 'physics' | 'models' | 'sounds' | 'world' | 'ground' | 'scene' | 'frame';
export type BootState = 'waiting' | 'running' | 'done' | 'failed';

export const BOOT_STEPS: readonly BootStep[] = ['code', 'map', 'physics', 'models', 'sounds', 'world', 'ground', 'scene', 'frame'];

export const BOOT_TEXT = {
  code: t('boot.code'),
  map: t('boot.map'),
  physics: t('boot.physics'),
  models: t('boot.models'),
  sounds: t('boot.sounds'),
  loadSave: t('boot.loadSave'),
  newGame: t('boot.newGame'),
  ground: t('boot.ground'),
  scene: t('boot.scene'),
  frame: t('boot.frame'),
} as const;

interface Entry {
  state: BootState;
  label: Msg;
  done: number;
  total: number | null;
}

export class BootProgress {
  private readonly entries = new Map<BootStep, Entry>();
  failed = false;

  constructor() {
    for (const step of BOOT_STEPS) {
      const label = step === 'world' ? BOOT_TEXT.loadSave : BOOT_TEXT[step];
      this.entries.set(step, { state: 'waiting', label, done: 0, total: null });
    }
    this.start('code');
  }

  start(step: BootStep, label?: Msg): void {
    const entry = this.entry(step);
    if (this.failed) throw new Error(`Boot already failed, cannot change ${step}`);
    if (entry.state !== 'waiting') throw new Error(`Boot step ${step} is ${entry.state}, not waiting`);
    entry.state = 'running';
    if (label !== undefined) entry.label = label;
  }

  count(step: BootStep, done: number, total: number): void {
    const entry = this.running(step);
    if (done > total) throw new Error(`Boot step ${step} counted ${done} of ${total}`);
    if (done < entry.done) throw new Error(`Boot step ${step} count fell from ${entry.done} to ${done}`);
    entry.done = done;
    entry.total = total;
  }

  finish(step: BootStep): void {
    this.running(step).state = 'done';
  }

  fail(step: BootStep): void {
    this.running(step).state = 'failed';
    this.failed = true;
  }

  state(step: BootStep): BootState {
    return this.entry(step).state;
  }

  label(step: BootStep): Msg {
    return this.entry(step).label;
  }

  get total(): number {
    return BOOT_STEPS.length;
  }

  get finished(): number {
    return BOOT_STEPS.filter((s) => this.state(s) === 'done').length;
  }

  // The running steps' labels with counts, joined.
  get stageLine(): Msg | null {
    const running = this.runningEntries();
    return running.length > 0 ? list(running.map((e) => (e.total === null ? e.label : t('boot.counted', { label: e.label, done: e.done, total: e.total })))) : null;
  }

  // The same without counts, so it changes only when the set of running steps does.
  get liveLine(): Msg | null {
    const running = this.runningEntries();
    return running.length > 0 ? list(running.map((e) => e.label)) : null;
  }

  private runningEntries(): Entry[] {
    return BOOT_STEPS.map((s) => this.entry(s)).filter((e) => e.state === 'running');
  }

  private entry(step: BootStep): Entry {
    const entry = this.entries.get(step);
    if (!entry) throw new Error(`Unknown boot step ${step}`);
    return entry;
  }

  private running(step: BootStep): Entry {
    const entry = this.entry(step);
    if (this.failed) throw new Error(`Boot already failed, cannot change ${step}`);
    if (entry.state !== 'running') throw new Error(`Boot step ${step} is ${entry.state}, not running`);
    return entry;
  }
}
