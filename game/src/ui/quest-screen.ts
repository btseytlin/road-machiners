// The talk window. It shows whenever the world holds a live quest, so a start, a pick and a load all draw here.
// A transcript quest keeps the exchanges of this talk. A page quest shows one page at a time beside its art and
// numbers. The newest lines reveal by their markup. A click, Space or Enter shows everything at once.

import { localOfQuest } from '../sim/dialogue-rules';
import { chooseQuestOption, leaveQuest, QUESTS, questView, type QuestView } from '../sim/quests';
import type { QuestLine, QuestLive, World } from '../sim/types';
import { createIcon } from './cards';
import { el, isBrowserChord, panel } from './dom';
import { questArtUrl } from '../data/quest-art';
import type { UiHost } from './host';
import { choiceButtons, drawLines, lastTagged, pagesOf } from './quest-lines';
import { renderLine } from './quest-text';

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
  private page = 0;
  private artBefore: string | null = null;
  private placeBefore: string | null = null;
  private factsBefore = new Set<string>();
  private factsShown: string[] = [];
  private revealEnd = 0;

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
    if (!live) return this.hide();
    if (live.quest === this.shown?.quest && live.ink === this.shown.ink) return;
    this.carry(live);
    this.transcript = extendTranscript(this.transcript, this.shown, live, this.asked);
    this.shown = live;
    this.asked = null;
    this.page = 0;
    this.draw();
  }

  private carry(live: QuestLive): void {
    const shown = this.shown;
    if (shown?.quest !== live.quest || this.asked === null) return this.forget();
    const before = shown.lines;
    this.artBefore = lastTagged(before, 'img') ?? this.artBefore;
    this.placeBefore = lastTagged(before, 'place') ?? this.placeBefore;
    this.factsBefore = new Set(this.factsShown);
  }

  private forget(): void {
    this.artBefore = null;
    this.placeBefore = null;
    this.factsBefore = new Set();
  }

  private hide(): void {
    this.shown = null;
    this.transcript = [];
    this.error = '';
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  private draw(): void {
    const w = this.host.world();
    const view = questView(w, QUESTS);
    this.root.style.display = '';
    this.root.classList.remove('qt-done');
    this.root.classList.toggle('quest-page', view.view === 'page');
    const endMs = view.view === 'page' ? this.drawPage(w, view) : this.drawTranscript(w, view);
    this.revealEnd = performance.now() + endMs;
  }

  private drawTranscript(w: World, view: QuestView): number {
    const older = this.transcript.slice(0, -1).flatMap((x) => this.exchange(w, x, false).nodes);
    const newest = this.exchange(w, this.transcript[this.transcript.length - 1], true);
    const log = el('div', { class: 'quest-log' }, ...older, ...newest.nodes);
    this.root.replaceChildren(this.head(view.quest), log, this.choices(w, view, newest.endMs), this.errorLine());
    log.scrollTop = log.scrollHeight;
    return newest.endMs;
  }

  private exchange(w: World, x: Exchange, newest: boolean): { nodes: HTMLElement[]; endMs: number } {
    const drawn = drawLines(w, x.lines, 0, { inlineArt: true, offers: newest });
    const box = el('div', { class: newest ? 'quest-exchange' : 'quest-exchange qt-done' }, x.ask === null ? null : el('div', { class: 'talk-ask' }, x.ask), ...drawn.nodes);
    return { nodes: [box], endMs: drawn.endMs };
  }

  private drawPage(w: World, view: QuestView): number {
    const pages = pagesOf(view.lines);
    const shown = pages.slice(0, this.page + 1).flat();
    const drawn = drawLines(w, pages[this.page], 0, { inlineArt: false, offers: true });
    const last = this.page === pages.length - 1;
    const next = el('button', { class: 'quest-next qt-unit', style: `animation-delay: ${drawn.endMs}ms`, onclick: () => this.nextPage() }, 'Next');
    const place = lastTagged(shown, 'place') ?? this.placeBefore;
    const text = el('div', { class: 'quest-text' }, place ? el('h2', { class: 'quest-place' }, place) : null, ...drawn.nodes, last ? this.choices(w, view, drawn.endMs) : next, this.errorLine());
    this.root.replaceChildren(this.art(lastTagged(shown, 'img') ?? this.artBefore), text, this.side(view));
    return drawn.endMs;
  }

  private art(key: string | null): HTMLElement {
    return el('div', { class: 'quest-art' }, el('div', { class: 'quest-frame' }, key ? el('img', { src: questArtUrl(key), alt: '' }) : null));
  }

  private side(view: QuestView): HTMLElement {
    const stats = view.stats.map((s) => el('div', { class: 'quest-stat' }, el('span', {}, s.label), el('b', {}, s.value)));
    this.factsShown = view.facts;
    const facts = view.facts.map((f) => el('div', { class: this.factsBefore.has(f) ? 'quest-fact' : 'quest-fact new' }, renderLine(f, ['reveal:all'], 0).el));
    return el('div', { class: 'quest-side' }, this.leaveButton(), el('div', { class: 'quest-stats' }, ...stats), el('div', { class: 'quest-facts' }, ...facts));
  }

  private head(quest: string): HTMLElement {
    const local = localOfQuest(quest);
    return el('div', { class: 'talk-head' }, createIcon('driver'), local ? el('b', {}, local.name) : null, local ? el('span', { class: 'dim' }, local.role) : null, this.leaveButton());
  }

  private leaveButton(): HTMLElement {
    return el('button', { class: 'close', onclick: () => this.leave() }, 'Leave [Esc]');
  }

  private errorLine(): HTMLElement {
    return el('div', { class: 'error' }, this.error);
  }

  private choices(w: World, view: QuestView, atMs: number): HTMLElement {
    const buttons = view.ended ? [el('button', { class: 'quest-choice', onclick: () => this.leave() }, 'Leave')] : choiceButtons(w, view, (i) => this.choose(i));
    return el('div', { class: 'quest-choices qt-unit', style: `animation-delay: ${atMs}ms` }, ...buttons);
  }

  private nextPage(): void {
    this.page += 1;
    this.draw();
  }

  private choose(index: number): void {
    const view = questView(this.host.world(), QUESTS);
    if (view.locked[index]) return;
    this.asked = view.choices[index];
    this.run((w) => chooseQuestOption(w, QUESTS, index));
  }

  private leave(): void {
    this.run((w) => leaveQuest(w));
  }

  private run(cmd: (w: World) => World): void {
    this.error = '';
    try {
      this.host.announce(cmd(this.host.world()));
    } catch (e) {
      this.asked = null;
      this.error = (e as Error).message;
      if (this.host.world().player.quests.live) this.draw();
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

  private onLastPage(view: QuestView): boolean {
    return view.view === 'transcript' || this.page === pagesOf(view.lines).length - 1;
  }

  private pickKey(index: number): void {
    const view = questView(this.host.world(), QUESTS);
    if (!this.onLastPage(view)) return;
    if (view.ended) return this.leave();
    if (index < view.choices.length) this.choose(index);
  }

  private skip(e: KeyboardEvent): void {
    e.preventDefault();
    const revealing = !this.root.classList.contains('qt-done') && performance.now() < this.revealEnd;
    if (revealing) this.root.classList.add('qt-done');
    else if (!this.onLastPage(questView(this.host.world(), QUESTS))) this.nextPage();
  }
}
