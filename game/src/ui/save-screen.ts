// The boot screens for a save the game cannot load: the choice between migrating it and starting over,
// and the report of what the migration kept, refunded and lost.

import type { CarryReport } from '../sim/world';
import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { WORLD_SETTINGS } from '../data/modes';
import { percent } from '../sim/settings';
import { el, panel } from './dom';
import { openNewGame, type NewGameActions } from './new-game';
import { moneyText } from './units';

// Shows the choice and resolves when the player picks Migrate. New game opens the New game screen over it, whose Back
// returns here and whose Start reloads into the new game.
export function chooseSaveFate(reason: string, canMigrate: boolean, newGame: NewGameActions): Promise<void> {
  return new Promise((resolve) => {
    const root = savePanel('Your save needs migrating');
    const migrate = () => {
      root.remove();
      resolve();
    };
    root.append(
      el('div', {}, 'This update changed the world. Migrate keeps your skills, perks, money, truck, parts and cargo, and moves you to a town. The rest of the world starts fresh.'),
      el('div', { class: 'dim' }, reason),
      el(
        'div',
        { class: 'death-buttons' },
        el('button', { onclick: migrate, disabled: !canMigrate }, 'Migrate save'),
        el('button', { onclick: () => openNewGame(newGame, () => {}) }, 'New game'),
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
    ...report.settingsReset.map((id) => `${WORLD_SETTINGS[id].name} was reset to ${percent(WORLD_SETTINGS[id].default)}`),
  ];
}
