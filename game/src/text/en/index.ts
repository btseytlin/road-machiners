// English defines every text key. Each area file holds the entries of one part of the game.
import { DRIVERS } from './drivers';
import { LOG } from './log';
import { NAMES } from './names';
import { SCREENS } from './screens';
import { TALK } from './talk';
import { UI } from './ui';

export const EN = { ...DRIVERS, ...LOG, ...NAMES, ...SCREENS, ...TALK, ...UI };
