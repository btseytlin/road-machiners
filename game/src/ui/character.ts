// Character screen: skill levels, XP to the next level, today's XP against the daily cap, and perks. An open perk
// pair shows both perks as buttons, and a picked pair shows its perk.

import { MAX_SKILL_LEVEL, PERK_LEVELS, PERKS, type PerkId, SKILL_IDS, SKILL_INFO, XP_RULES, XP_TO_REACH } from '../data/skills';
import { maxHealthOf } from '../sim/health';
import { choosePerk, hasPerk, levelOf, pendingPerkPairs, perkPair, type PerkPair, xpTodayOf } from '../sim/progress';
import type { SkillId, World } from '../sim/types';
import { createIcon, type IconName } from './cards';
import { el, panel } from './dom';
import type { UiHost } from './host';
import { hp } from './units';

export class CharacterScreen {
  private root = panel('modal');

  constructor(private host: UiHost) {
    this.root.classList.add('character-screen');
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

  close(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const world = this.host.world();
    const p = world.player;
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, 'Close [C]'),
      el('h3', {}, 'Character', el('span', { class: 'chips' },
        el('span', { class: 'chip', title: 'Health' }, createIcon('driver'), `${hp(p.health)} / ${maxHealthOf(world)}`),
        el('span', { class: 'chip', title: 'Knockouts' }, createIcon('damage'), `${p.knockouts} knockouts`),
      )),
      el('div', { class: 'cards skill-cards' }, ...SKILL_IDS.map((id) => this.card(world, id))),
    );
  }

  private card(world: World, id: SkillId): HTMLElement {
    const xp = world.player.skills[id];
    const lvl = levelOf(xp);
    const today = xpTodayOf(world, id);
    const max = lvl === MAX_SKILL_LEVEL;
    const into = max ? 1 : (xp - XP_TO_REACH[lvl]) / (XP_TO_REACH[lvl + 1] - XP_TO_REACH[lvl]);
    return el('div', { class: 'card skill-card' },
      el('div', { class: 'card-head' },
        createIcon(SKILL_ICON[id]),
        el('div', { class: 'card-name' }, el('b', {}, SKILL_INFO[id].name), el('span', { class: 'dim' }, `Grows from ${SKILL_INFO[id].grows}`)),
        el('div', { class: 'skill-level', title: `Level ${lvl} of ${MAX_SKILL_LEVEL}` },
          ...Array.from({ length: MAX_SKILL_LEVEL }, (_, i) => el('i', { class: i < lvl ? 'on' : '' }))),
      ),
      el('div', { class: 'skill-line' }, el('span', {}, `Level ${lvl}`), el('span', {}, max ? 'max' : `${Math.floor(xp)} / ${XP_TO_REACH[lvl + 1]} XP`)),
      el('div', { class: 'meter' }, el('div', { style: `width:${into * 100}%` })),
      el('div', { class: 'skill-line dim' }, el('span', {}, 'Today'), el('span', {}, `${Math.floor(today)} / ${XP_RULES.dailyCap} XP`)),
      el('div', { class: 'meter today' }, el('div', { style: `width:${Math.min(today / XP_RULES.dailyCap, 1) * 100}%` })),
      ...this.perks(world, id),
    );
  }

  private perks(world: World, skill: SkillId): HTMLElement[] {
    const open = pendingPerkPairs(world);
    return PERK_LEVELS.map((level) => perkPair(skill, level)).flatMap((pair) => {
      const picked = pair.perks.find((id) => hasPerk(world, id));
      if (picked) return [el('div', { class: 'perk picked' }, el('b', {}, PERKS[picked].name), el('span', {}, PERKS[picked].rule))];
      if (!open.some((o) => o.skill === pair.skill && o.level === pair.level)) return [];
      return [this.choice(world, pair)];
    });
  }

  private choice(world: World, pair: PerkPair): HTMLElement {
    const canPick = world.player.state === 'active';
    const button = (id: PerkId) => el('button', {
      class: 'perk',
      disabled: !canPick,
      onclick: () => this.host.apply(choosePerk(this.host.world(), id)),
    }, el('b', {}, PERKS[id].name), el('span', {}, PERKS[id].rule));
    return el('div', { class: 'perk-choice' }, el('span', { class: 'good' }, `Level ${pair.level} perk: pick one`), ...pair.perks.map(button));
  }
}

const SKILL_ICON: Record<SkillId, IconName> = {
  driving: 'wheel',
  perception: 'scanner',
  machining: 'tools',
  toughness: 'armor',
  social: 'money',
};
