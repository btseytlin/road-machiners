// English defines every text key. Each area file holds the entries of one part of the game.
import { LOG } from './log';
import { NAMES } from './names';
import { SCREENS } from './screens';
import { TALK } from './talk';
import { UI } from './ui';

export const EN = { ...LOG, ...NAMES, ...SCREENS, ...TALK, ...UI };
