// The Russian review sheet: every catalog entry in English and in Russian, resolved with sample params, so agreement,
// case and plural errors show up as wrong words in a sentence, the way the player sees them. It writes one Markdown
// file per area to tmp/text-review/. Text params get a name of each gender, counts get 1, 3, 5 and 1.5, and a param a
// text asks a place case of gets a place. A sample that does not resolve shows its error in the sheet.
import { mkdirSync, writeFileSync } from 'node:fs';
import { DRIVERS } from '../src/text/en/drivers.ts';
import { LOG } from '../src/text/en/log.ts';
import { NAMES } from '../src/text/en/names.ts';
import { SCREENS } from '../src/text/en/screens.ts';
import { TALK } from '../src/text/en/talk.ts';
import { UI } from '../src/text/en/ui.ts';
import { byId, GENDERS, PLACE_CASES } from '../src/text/msg.ts';
import { entryText, nounOf, parse, resolve, schemaOf } from '../src/text/resolve.ts';

const OUT = 'tmp/text-review';
const AREAS = { names: NAMES, log: LOG, talk: TALK, screens: SCREENS, ui: UI, drivers: DRIVERS };
const COUNTS = [1, 3, 5, 1.5];
const NUMBERS = [1200, 2.5];
const PERSON = 'Sam Ruiz';

// One part name of each gender, the first the catalog lists, and the first place.
const partKeys = Object.keys(NAMES).filter((key) => /^part\.[^.]+$/.test(key));
const SAMPLES = GENDERS.map((gender) => {
  const key = partKeys.find((k) => nounOf('ru', k)?.gender === gender);
  if (!key) throw new Error(`No part name of gender ${gender} to sample`);
  return key;
});
const PLACE = Object.keys(NAMES).find((key) => key.startsWith('site.') && nounOf('ru', key)?.place);
if (!PLACE) throw new Error('No place name to sample');

// The text params a Russian entry asks a place case of.
function placeParams(key) {
  const asked = new Set();
  const visit = (parts) => {
    for (const part of parts) {
      if (part.kind === 'arg' && PLACE_CASES.includes(part.case)) asked.add(part.name);
      if ('forms' in part) for (const form of part.forms.values()) visit(form);
    }
  };
  visit(parse(entryText('ru', key)));
  return asked;
}

// Row i of the samples for a key: every text param takes the name of gender i, every count takes COUNTS[i].
function sampleParams(key, i) {
  const places = placeParams(key);
  const params = {};
  for (const [name, kind] of Object.entries(schemaOf(key))) {
    if (kind === 'text') params[name] = byId(places.has(name) ? PLACE : SAMPLES[i % SAMPLES.length]);
    else if (kind === 'count') params[name] = COUNTS[i % COUNTS.length];
    else if (kind === 'name') params[name] = PERSON;
    else params[name] = NUMBERS[i % NUMBERS.length];
  }
  return params;
}

function rows(key) {
  const kinds = Object.values(schemaOf(key));
  return kinds.includes('text') || kinds.includes('count') ? 4 : 1;
}

function said(key, params, locale) {
  try {
    return resolve(byId(key, params), locale);
  } catch (error) {
    return `ERROR: ${error.message}`;
  }
}

function sampleNote(params) {
  const shown = Object.entries(params).map(([name, value]) => `${name}=${typeof value === 'object' ? value.key : value}`);
  return shown.length ? ` _(${shown.join(', ')})_` : '';
}

function entryLines(key) {
  const noun = nounOf('ru', key);
  if (noun) {
    const forms = Object.values(noun.forms).join(', ');
    const place = noun.place ? ` — at «${noun.place.at}», to «${noun.place.to}», from «${noun.place.from}»` : '';
    return [`### ${key}`, `- en: ${entryText('en', key)}`, `- ru (${noun.gender}): ${forms}${place}`, ''];
  }
  const lines = [`### ${key}`, `- raw: \`${entryText('ru', key)}\``];
  for (let i = 0; i < rows(key); i++) {
    const params = sampleParams(key, i);
    lines.push(`- en: ${said(key, params, 'en')}`, `  ru: ${said(key, params, 'ru')}${sampleNote(params)}`);
  }
  return [...lines, ''];
}

mkdirSync(OUT, { recursive: true });
for (const [area, catalog] of Object.entries(AREAS)) {
  const keys = Object.keys(catalog);
  const head = [`# Russian review: ${area}`, '', `Samples: ${SAMPLES.join(', ')}; place ${PLACE}; counts ${COUNTS.join(', ')}.`, ''];
  writeFileSync(`${OUT}/${area}.md`, [...head, ...keys.flatMap(entryLines)].join('\n'));
  console.log(`${OUT}/${area}.md: ${keys.length} entries`);
}
