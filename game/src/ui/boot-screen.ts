// The boot screen: renders a BootProgress into the static #boot markup of index.html.

import { BOOT_STEPS, BOOT_TEXT, BootProgress, type BootStep } from './boot-progress';

const FADE_MS = 250;

function part(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`${selector} missing from #boot`);
  return el;
}

export class BootScreen {
  private readonly progress = new BootProgress();
  private readonly bar: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly segments = new Map<BootStep, HTMLElement>();
  private readonly lines = new Map<BootStep, HTMLElement>();
  private readonly announcer: HTMLElement;
  private live = '';

  private constructor(private readonly root: HTMLElement) {
    this.bar = part(root, '[role=progressbar]');
    this.stage = part(root, '.boot-stage');
    const list = part(root, '.boot-steps');
    // The visible line changes on every file. A hidden live region speaks only when the running steps change.
    this.stage.setAttribute('aria-live', 'off');
    this.announcer = document.createElement('p');
    this.announcer.className = 'boot-live';
    this.announcer.setAttribute('aria-live', 'polite');
    root.append(this.announcer);
    this.bar.replaceChildren();
    list.replaceChildren();
    for (const step of BOOT_STEPS) {
      const seg = document.createElement('span');
      seg.className = 'boot-seg';
      this.bar.append(seg);
      this.segments.set(step, seg);
      const line = document.createElement('li');
      line.append(document.createElement('span'), document.createElement('span'));
      list.append(line);
      this.lines.set(step, line);
    }
    root.dataset.adopted = 'true';
    this.progress.finish('code');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', String(this.progress.total));
    this.render();
  }

  static adopt(): BootScreen {
    const root = document.getElementById('boot');
    if (!root) throw new Error('#boot element missing from the page');
    return new BootScreen(root);
  }

  // Runs one boot step. A function waits for its label to paint first, since it blocks the page until it returns.
  async track<T>(step: BootStep, work: Promise<T> | (() => T), label?: string): Promise<T> {
    this.progress.start(step, label);
    this.render();
    try {
      if (typeof work === 'function') await this.painted();
      const result = await (typeof work === 'function' ? work() : work);
      this.progress.finish(step);
      this.render();
      return result;
    } catch (err) {
      if (!this.progress.failed) this.progress.fail(step);
      this.render();
      throw err;
    }
  }

  // The progress callback for a counted step.
  count(step: BootStep): (done: number, total: number) => void {
    return (done, total) => {
      this.progress.count(step, done, total);
      this.render();
    };
  }

  // Hides the screen while the player decides something, then brings it back.
  async aside<T>(work: () => Promise<T>): Promise<T> {
    this.root.hidden = true;
    try {
      return await work();
    } finally {
      this.root.hidden = false;
    }
  }

  // Resolves after the page has had a chance to paint. A hidden tab paints nothing, so it waits one task only.
  async painted(): Promise<void> {
    if (!document.hidden) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve));
  }

  // Call once the game is built. Waits for its first frame to be drawn, then fades out and removes the screen.
  async finish(): Promise<void> {
    this.progress.start('frame');
    this.render();
    if (!document.hidden) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    this.progress.finish('frame');
    this.render();
    const still = document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) return this.root.remove();
    this.root.classList.add('leaving');
    this.root.addEventListener('transitionend', () => this.root.remove(), { once: true });
    // A fade that never reports its end must not leave the screen over the game.
    setTimeout(() => this.root.remove(), FADE_MS * 2);
  }

  private failure(): string {
    const step = BOOT_STEPS.find((s) => this.progress.state(s) === 'failed');
    return step ? `${this.progress.label(step)} ${BOOT_TEXT.failed}` : BOOT_TEXT.failedToLoad;
  }

  private render(): void {
    for (const step of BOOT_STEPS) this.renderStep(step);
    const p = this.progress;
    const text = this.stageText();
    this.bar.setAttribute('aria-valuenow', String(p.finished));
    this.bar.setAttribute('aria-valuetext', text);
    this.stage.textContent = text;
    this.announce(p.failed ? text : p.liveLine);
    this.root.classList.toggle('failed', p.failed);
    if (p.failed) this.root.setAttribute('aria-busy', 'false');
  }

  // Between two steps nothing runs, and the line keeps its last text.
  private stageText(): string {
    if (this.progress.failed) return this.failure();
    return this.progress.stageLine || this.stage.textContent || '';
  }

  private renderStep(step: BootStep): void {
    const state = this.progress.state(step);
    const segment = this.segments.get(step);
    const line = this.lines.get(step);
    if (!segment || !line) throw new Error(`Boot step ${step} has no view`);
    segment.className = `boot-seg ${state}`;
    line.className = state;
    const [name, status] = Array.from(line.children);
    name.textContent = this.progress.label(step);
    status.textContent = state === 'running' ? BOOT_TEXT.running : BOOT_TEXT[state];
  }

  private announce(live: string): void {
    if (!live || live === this.live) return;
    this.live = live;
    this.announcer.textContent = live;
  }
}
