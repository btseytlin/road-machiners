// Journal screen: the rumors and clues the player was told, newest first, as information rather than orders. The
// notes are player.notes, written by src/sim/notes.ts, with their words in src/data/locals.ts.

import { NOTES, type NoteDef } from '../data/locals';
import { clockOf } from '../sim/sun';
import type { World } from '../sim/types';
import { createIcon } from './cards';
import { el, panel } from './dom';
import type { UiHost } from './host';

export type JournalEntry = NoteDef & { day: number };

// The held notes, the newest first, with the day each was learned. Notes learned on one turn keep their order.
export function journalEntries(world: World): JournalEntry[] {
  return world.player.notes.map((n, k) => ({ n, k })).sort((a, b) => b.n.turn - a.n.turn || b.k - a.k).map(({ n }) => ({ ...NOTES[n.id], day: clockOf(n.turn).day }));
}

export class JournalScreen {
  private root = panel('modal');

  constructor(private host: UiHost) {
    this.root.classList.add('journal-screen');
    this.root.style.display = 'none';
  }

  isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle(): void {
    if (this.isOpen()) return this.close();
    this.root.style.display = '';
    this.render();
  }

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const entries = journalEntries(this.host.world());
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, 'Close [J]'),
      el('h3', {}, createIcon('journal'), 'Journal'),
      entries.length ? el('div', { class: 'journal' }, ...entries.map(entry)) : el('div', { class: 'dim' }, 'Nothing worth writing down yet.'),
    );
  }
}

function entry(e: JournalEntry): HTMLElement {
  return el(
    'div',
    { class: 'journal-note' },
    el('div', { class: 'journal-head' }, el('b', {}, e.title), el('span', { class: 'dim' }, `Day ${e.day}, ${e.from}`)),
    el('div', {}, e.text),
  );
}
