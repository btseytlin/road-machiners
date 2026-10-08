// The talk window. It shows whenever the world holds a live quest, so a start, a pick and a load all draw here.
// The newest lines reveal by their markup and the choices follow. A click, Space or Enter shows everything at once.

import { localOfQuest, townWork } from '../sim/dialogue-rules';
import { chooseQuestOption, leaveQuest, QUESTS } from '../sim/quests';
import type { QuestLine, QuestLive, World } from '../sim/types';
import { createIcon } from './cards';
import { el, isBrowserChord, panel } from './dom';
import { contractSummary, contractWindow } from './format';
import type { UiHost } from './host';
import { lineStyle, renderLine } from './quest-text';
import { moneyText } from './units';

export type Exchange = { ask: string | null; lines: QuestLine[] };

const KEY_DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
const SKIP_KEYS = new Set(['Space', 'Enter', 'NumpadEnter']);

export function extendTranscript(transcript: readonly Exchange[], shown: QuestLive | null, live: QuestLive, ask: string | null): Exchange[] {
  if (ask === null || shown?.quest !== live.quest) return [{ ask: null, lines: live.lines }];
  return [...transcript, { ask, lines: live.lines }];
}

export class QuestScreen {
  private root = panel('modal');
  private shown: QuestLive | null = null;
  private transcript: Exchange[] = [];
  private asked: string | null = null;
  private error = '';

  constructor(private host: UiHost) {
    this.root.classList.add('quest-screen');
    this.root.style.display = 'none';
    this.root.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  isOpen(): boolean {
    return this.host.world().player.quests.live !== null;
  }

  render(): void {
    const live = this.host.world().player.quests.live;
    if (live === this.shown) return;
    if (!live) return this.hide();
    this.transcript = extendTranscript(this.transcript, this.shown, live, this.asked);
    this.shown = live;
    this.asked = null;
    this.draw(this.host.world(), live);
  }

  private hide(): void {
    this.shown = null;
    this.transcript = [];
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  private draw(w: World, live: QuestLive): void {
    this.root.style.display = '';
    this.root.classList.remove('qt-done');
    const older = this.transcript.slice(0, -1).map((x) => this.exchange(w, x, false).el);
    const newest = this.exchange(w, this.transcript[this.transcript.length - 1], true);
    const log = el('div', { class: 'quest-log' }, ...older, newest.el);
    this.root.replaceChildren(this.head(live.quest), log, this.choices(w, live, newest.endMs), el('div', { class: 'error' }, this.error));
    log.scrollTop = log.scrollHeight;
  }

  private head(quest: string): HTMLElement {
    const local = localOfQuest(quest);
    return el(
      'div',
      { class: 'talk-head' },
      createIcon('driver'),
      local ? el('b', {}, local.name) : null,
      local ? el('span', { class: 'dim' }, local.role) : null,
      el('button', { class: 'close', onclick: () => this.leave() }, 'Leave [Esc]'),
    );
  }

  private exchange(w: World, x: Exchange, newest: boolean): { el: HTMLElement; endMs: number } {
    const box = el('div', { class: newest ? 'quest-exchange' : 'quest-exchange qt-done' });
    if (x.ask !== null) box.append(el('div', { class: 'talk-ask' }, x.ask));
    let at = 0;
    for (const line of x.lines) {
      const drawn = renderLine(line.text, line.tags, at);
      box.append(drawn.el);
      if (newest && lineStyle(line.tags).flags.includes('work_offer')) box.append(offerCard(w, drawn.endMs));
      at = drawn.endMs;
    }
    return { el: box, endMs: at };
  }

  private choices(w: World, live: QuestLive, atMs: number): HTMLElement {
    const ended = w.player.quests.session === null;
    const buttons = ended
      ? [el('button', { class: 'quest-choice', onclick: () => this.leave() }, 'Leave')]
      : live.choices.map((text, i) => el('button', { class: 'quest-choice', 'data-choice': String(i), onclick: () => this.choose(i, text) }, `${i + 1}. ${text}`));
    return el('div', { class: 'quest-choices qt-unit', style: `animation-delay: ${atMs}ms` }, ...buttons);
  }

  private choose(index: number, text: string): void {
    this.asked = text;
    this.run((w) => chooseQuestOption(w, QUESTS, index));
  }

  private leave(): void {
    this.run((w) => leaveQuest(w));
  }

  private run(cmd: (w: World) => World): void {
    try {
      this.host.announce(cmd(this.host.world()));
      this.error = '';
    } catch (e) {
      this.asked = null;
      this.error = (e as Error).message;
      const live = this.host.world().player.quests.live;
      if (live) this.draw(this.host.world(), live);
    }
  }

  private onClick(e: MouseEvent): void {
    if (!(e.target instanceof HTMLElement) || e.target.closest('button')) return;
    this.root.classList.add('qt-done');
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen() || isBrowserChord(e)) return;
    e.stopImmediatePropagation();
    if (e.code === 'Escape') return this.leave();
    if (SKIP_KEYS.has(e.code)) return this.skip(e);
    const index = KEY_DIGITS.indexOf(e.code);
    if (index >= 0) this.pickKey(index);
  }

  private pickKey(index: number): void {
    const { live, session } = this.host.world().player.quests;
    if (!live) return;
    if (session === null) return this.leave();
    if (index < live.choices.length) this.choose(index, live.choices[index]);
  }

  private skip(e: KeyboardEvent): void {
    e.preventDefault();
    this.root.classList.add('qt-done');
  }
}

function offerCard(w: World, atMs: number): HTMLElement {
  const offer = townWork(w);
  if (!offer) throw new Error('A work offer line showed with no work on the board');
  return el('div', { class: 'talk-offer qt-unit', style: `animation-delay: ${atMs}ms` }, `${contractSummary(offer)}, pays ${moneyText(offer.reward)}, within ${contractWindow(offer)}.`);
}
