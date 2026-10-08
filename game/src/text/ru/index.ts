// Russian gives a string for every English key. A missing key fails tsc.
import type { EN } from '../en';
import type { Translation } from '../msg';
import { DRIVERS } from './drivers';
import { LOG } from './log';
import { NAMES } from './names';
import { SCREENS } from './screens';
import { TALK } from './talk';
import { UI } from './ui';

export const RU: Translation<typeof EN> = { ...DRIVERS, ...LOG, ...NAMES, ...SCREENS, ...TALK, ...UI };
