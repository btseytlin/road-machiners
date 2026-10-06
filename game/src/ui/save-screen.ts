// The boot screens for a save the game cannot load: the choice between migrating it and starting over,
// and the report of what the migration kept, refunded and lost.

import type { CarryReport } from '../sim/world';
import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { el, panel } from './dom';
import { moneyText } from './units';

export type SaveFate = 'migrate' | 'new';

export const CONFIRM_NEW_GAME = 'Start a new game? The autosaves are deleted. Your save slots stay.';

// Shows the choice and resolves with the player's pick. New game asks first, and a no leaves the screen up.
export function chooseSaveFate(reason: string, canMigrate: boolean): Promise<SaveFate> {
  return new Promise((resolve) => {
    const root = savePanel('Your save needs migrating');
    const done = (fate: SaveFate) => {
      root.remove();
      resolve(fate);
    };
    const confirmNew = () => {
      if (window.confirm(CONFIRM_NEW_GAME)) done('new');
    };
    root.append(
      el('div', {}, 'This update changed the world. Migrate keeps your skills, perks, money, truck, parts and cargo, and moves you to a town. The rest of the world starts fresh.'),
      el('div', { class: 'dim' }, reason),
      el(
        'div',
        { class: 'death-buttons' },
        el('button', { onclick: () => done('migrate'), disabled: !canMigrate }, 'Migrate save'),
        el('button', { onclick: confirmNew }, 'New game'),
      ),
    );
    if (!canMigrate) root.append(el('div', { class: 'dim' }, 'The save is unreadable'));
  });
}

// Shows what the migration did. Resolves when the player drives on.
export function showCarryReport(report: CarryReport): Promise<void> {
  return new Promise((resolve) => {
    const root = savePanel('Save migrated');
    const lines = reportLines(report);
    root.append(
      ...(lines.length === 0 ? [el('div', {}, 'Everything carried over')] : lines.map((line) => el('div', {}, line))),
      el('div', { class: 'death-buttons' }, el('button', { onclick: () => { root.remove(); resolve(); } }, 'Drive on')),
    );
  });
}

function savePanel(title: string): HTMLElement {
  const root = panel('death save-screen');
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-label', title);
  root.append(el('h3', {}, title));
  return root;
}

function reportLines(report: CarryReport): string[] {
  const garage = report.toGarage.map((id) => partDef(id).name);
  const sold = report.sold.map((s) => `${s.units} ${GOODS[s.good].name} sold for ${moneyText(s.money)}`);
  return [
    ...(garage.length > 0 ? [`Moved to the garage: ${garage.join(', ')}`] : []),
    ...sold,
    ...(report.lost.length > 0 ? [`Lost, no longer in the game: ${report.lost.join(', ')}`] : []),
  ];
}
