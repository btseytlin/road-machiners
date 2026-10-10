// Draws quest lines for both talk views: revealed text, speaker names, tables from row lines, pictures and work
// offers. Also splits a page view's lines into pages at each `# page` line.

import { questArtUrl } from '../data/quest-art';
import { townWork } from '../sim/dialogue-rules';
import type { QuestView } from '../sim/quests';
import type { QuestLine, World } from '../sim/types';
import { t, verbatim } from '../text/msg';
import { el } from './dom';
import { contractSummary, contractWindow } from './format';
import { lineStyle, renderLine, rowCells } from './quest-text';
import { moneyMsg } from './units';

export type Drawn = { nodes: HTMLElement[]; endMs: number };
type Options = { inlineArt: boolean; offers: boolean };

export function pagesOf(lines: readonly QuestLine[]): QuestLine[][] {
  const pages: QuestLine[][] = [[]];
  for (const line of lines) {
    if (lineStyle(line.tags).flags.includes('page') && pages[pages.length - 1].length > 0) pages.push([]);
    pages[pages.length - 1].push(line);
  }
  return pages;
}

export function lastTagged(lines: readonly QuestLine[], key: 'img' | 'place'): string | null {
  return lines.reduce<string | null>((found, line) => lineStyle(line.tags)[key] ?? found, null);
}

export function drawLines(w: World, lines: readonly QuestLine[], startMs: number, options: Options): Drawn {
  const nodes: HTMLElement[] = [];
  let at = startMs;
  for (const line of lines) {
    const head = rowKind(line);
    if (head === null) at = drawLine(nodes, w, line, at, options);
    else tableAt(nodes, at).append(tableRow(line.text, head));
  }
  return { nodes, endMs: at };
}

function rowKind(line: QuestLine): boolean | null {
  const flags = lineStyle(line.tags).flags;
  if (flags.includes('head')) return true;
  return flags.includes('row') ? false : null;
}

function tableAt(nodes: HTMLElement[], atMs: number): HTMLElement {
  const last = nodes[nodes.length - 1];
  if (last?.tagName === 'TABLE') return last;
  const table = el('table', { class: 'qt-table qt-unit', style: `animation-delay: ${atMs}ms` });
  nodes.push(table);
  return table;
}

function tableRow(text: string, head: boolean): HTMLElement {
  return el('tr', {}, ...rowCells(text).map((cell) => el(head ? 'th' : 'td', {}, verbatim(cell))));
}

function drawLine(nodes: HTMLElement[], w: World, line: QuestLine, atMs: number, options: Options): number {
  const style = lineStyle(line.tags);
  if (style.img && options.inlineArt) nodes.push(el('img', { class: 'qt-img qt-unit', src: questArtUrl(style.img), 'aria-hidden': 'true', style: `animation-delay: ${atMs}ms` }));
  const drawn = renderLine(line.text, line.tags, atMs);
  if (style.speaker) drawn.el.prepend(el('b', { class: 'qt-speaker' }, t('quest.speaker', { name: verbatim(style.speaker) })));
  nodes.push(drawn.el);
  if (options.offers && style.flags.includes('work_offer')) nodes.push(offerCard(w, drawn.endMs));
  return drawn.endMs;
}

function offerCard(w: World, atMs: number): HTMLElement {
  const offer = townWork(w);
  if (!offer) throw new Error('A work offer line showed with no work on the board');
  return el('div', { class: 'talk-offer qt-unit', style: `animation-delay: ${atMs}ms` }, t('quest.offer', { summary: contractSummary(offer), pay: moneyMsg(offer.reward), window: contractWindow(offer) }));
}

export function choiceButtons(w: World, view: QuestView, pick: (index: number) => void): HTMLElement[] {
  return view.choices.map((text, i) => {
    const locked = view.locked[i];
    const held = locked ? el('span', { class: 'quest-held' }, moneyMsg(w.player.money)) : null;
    return el('button', { class: 'quest-choice', 'data-choice': String(i), disabled: locked, onclick: () => pick(i) }, t('quest.choice', { n: i + 1, text: verbatim(text) }), held);
  });
}
