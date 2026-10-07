// The boot screens for a save the game cannot load: the choice between migrating it and starting over,
// and the report of what the migration kept, refunded and lost.

import type { CarryReport } from '../sim/world';
import { bindAttr, language, say } from '../text/language';
import { LanguageSwitch } from './language-switch';
import { list, t, verbatim, type Msg } from '../text/msg';
import { goodName, partName } from '../text/names';
import type { SaveError } from '../three/save';
import { el, panel } from './dom';

export type SaveFate = 'migrate' | 'new';

export const CONFIRM_NEW_GAME = t('save.confirmNew');

// Why a save does not load, in words.
export function saveErrorText(error: SaveError): Msg {
  const code = error.code;
  if (code !== 'incompatible' && code !== 'newer' && code !== 'notMigrated') return t(`save.error.${code}`);
  if (!error.format) throw new Error(`Save error ${code} names no format`);
  return t(`save.error.${code}`, error.format);
}

// Shows the choice and resolves with the player's pick. New game asks first, and a no leaves the screen up.
export function chooseSaveFate(reason: Msg, canMigrate: boolean): Promise<SaveFate> {
  return new Promise((resolve) => {
    const root = savePanel(t('save.needsMigrating'));
    const done = (fate: SaveFate) => {
      root.remove();
      resolve(fate);
    };
    const confirmNew = () => {
      if (window.confirm(say(CONFIRM_NEW_GAME))) done('new');
    };
    root.append(
      el('div', {}, t('save.migrateExplain')),
      el('div', { class: 'dim' }, reason),
      el(
        'div',
        { class: 'death-buttons' },
        el('button', { onclick: () => done('migrate'), disabled: !canMigrate }, t('save.migrate')),
        el('button', { onclick: confirmNew }, t('menu.newGame')),
      ),
    );
    if (!canMigrate) root.append(el('div', { class: 'dim' }, t('save.unreadable')));
  });
}

// Shows what the migration did. Resolves when the player drives on.
export function showCarryReport(report: CarryReport): Promise<void> {
  return new Promise((resolve) => {
    const root = savePanel(t('save.migrated'));
    const lines = reportLines(report);
    root.append(
      ...(lines.length === 0 ? [el('div', {}, t('save.allCarried'))] : lines.map((line) => el('div', {}, line))),
      el('div', { class: 'death-buttons' }, el('button', { onclick: () => { root.remove(); resolve(); } }, t('save.driveOn'))),
    );
  });
}

function savePanel(title: Msg): HTMLElement {
  const root = panel('death save-screen');
  root.setAttribute('role', 'alertdialog');
  bindAttr(root, 'aria-label', title);
  root.append(el('h3', {}, title));
  // Boot shows these screens before any menu, so they carry the language control in their header.
  new LanguageSwitch(root, language());
  return root;
}

// Lost ids are no longer in the game, so they have no words. They show as the ids the save held.
function reportLines(report: CarryReport): Msg[] {
  const sold = report.sold.map((s) => t('save.sold', { n: s.units, good: goodName(s.good), money: s.money }));
  return [
    ...(report.toGarage.length > 0 ? [t('save.toGarage', { parts: list(report.toGarage.map(partName)) })] : []),
    ...sold,
    ...(report.lost.length > 0 ? [t('save.lost', { ids: list(report.lost.map(verbatim)) })] : []),
  ];
}
