// The journal: rumors and clues the player was told, kept as notes. learnNote is the only writer of player.notes.

import { NOTES, type NoteId } from '../data/locals';
import type { World } from './types';

// Adds the note with the turn it was learned and tells the log. A held note stays as it was, with no event.
export function learnNote(world: World, id: NoteId): void {
  if (!(id in NOTES)) throw new Error(`No note ${id}`);
  if (holdsNote(world, id)) return;
  world.player.notes.push({ id, turn: world.turn });
  world.events.push({ t: 'note', id });
}

export function holdsNote(world: World, id: NoteId): boolean {
  return world.player.notes.some((n) => n.id === id);
}
