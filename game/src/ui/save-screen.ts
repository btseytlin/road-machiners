// The boot screens for a save the game cannot load: the choice between migrating it and starting over,
// and the report of what the migration kept, refunded and lost.

import type { CarryReport } from '../sim/world';
import { bindAttr } from '../text/language';
import { list, t, verbatim, type Msg } from '../text/msg';
import { goodName, partName, settingName } from '../text/names';
import { WORLD_SETTINGS } from '../data/modes';
import type { SaveError } from '../three/save';
import { download, el, panel } from './dom';
import { openNewGame, type NewGameActions } from './new-game';
import { OptionsPanel } from './options';
import { moneyMsg } from './units';

// Why a save does not load, in words.
export function saveErrorText(error: SaveError): Msg {
  const code = error.code;
  if (code !== 'incompatible' && code !== 'newer' && code !== 'notMigrated') return t(`save.error.${code}`);
  if (!error.format) throw new Error(`Save error ${code} names no format`);
  return t(`save.error.${code}`, error.format);
}

export function chooseSaveFate(reason: Msg, canMigrate: boolean, stored: unknown, newGame: NewGameActions): Promise<void> {
  return new Promise((resolve) => {
    const root = savePanel(t('save.needsMigrating'));
    const migrate = () => {
      root.remove();
      resolve();
    };
    root.append(
      el('div', {}, t('save.migrateExplain')),
      el('div', { class: 'dim' }, reason),
      el(
        'div',
        { class: 'death-buttons' },
        el('button', { onclick: migrate, disabled: !canMigrate }, t('save.migrate')),
        el('button', { onclick: () => openNewGame(newGame, () => {}) }, t('menu.newGame')),
        el('button', { onclick: () => downloadSave(stored) }, t('save.download')),
      ),
    );
    if (!canMigrate) root.append(el('div', { class: 'dim' }, t('save.unreadable')));
    root.append(el('div', { class: 'dim' }, t('save.reportBug')));
  });
}

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

function downloadSave(stored: unknown): void {
  download('roam-save.json', typeof stored === 'string' ? stored : JSON.stringify(stored), 'application/json');
}

// Boot shows these screens before any menu, so their header opens the same Options panel the Menu does.
const options = new OptionsPanel(() => document.querySelector<HTMLElement>('.save-screen .options-button')?.focus());

function savePanel(title: Msg): HTMLElement {
  const root = panel('death save-screen');
  root.setAttribute('role', 'alertdialog');
  bindAttr(root, 'aria-label', title);
  root.append(el('h3', {}, title), el('button', { class: 'options-button', onclick: () => options.open() }, t('menu.options')));
  return root;
}

// Lost ids are no longer in the game, so they have no words. They show as the ids the save held.
function reportLines(report: CarryReport): Msg[] {
  const sold = report.sold.map((s) => t('save.sold', { n: s.units, good: goodName(s.good), money: moneyMsg(s.money) }));
  return [
    ...(report.toGarage.length > 0 ? [t('save.toGarage', { parts: list(report.toGarage.map(partName)) })] : []),
    ...sold,
    ...(report.lost.length > 0 ? [t('save.lost', { ids: list(report.lost.map(verbatim)) })] : []),
    ...report.settingsReset.map((id) => t('save.settingReset', { setting: settingName(id), pct: Math.round(WORLD_SETTINGS[id].default * 100) })),
  ];
}
