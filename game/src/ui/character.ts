// Character screen: the XP pool, and per skill its rank, a button that buys the next rank, today's XP of its activity
// family against the daily cap, and perks. An open perk pair shows both perks as buttons, a picked pair shows its perk
// and a pair above the rank shows what it needs.

import { MAX_RANK, PERK_LEVELS, PERKS, type PerkId, SKILL_IDS, SKILL_INFO, XP_RULES } from '../data/skills';
import { maxHealthOf } from '../sim/health';
import { buyRank, canBuyRank, choosePerk, hasPerk, pendingPerkPairs, perkPair, type PerkPair, rankCost, xpTodayOf } from '../sim/progress';
import type { SkillId, World } from '../sim/types';
import { createIcon, type IconName } from './cards';
import { el, panel } from './dom';
import type { UiHost } from './host';
import { hp } from './units';

export class CharacterScreen {
  private root = panel('modal dialog');

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
        el('span', { class: 'chip xp-pool', title: 'XP earned by doing things, to spend on skill ranks' }, `XP to spend: ${Math.floor(p.xp)}`),
      )),
      el('div', { class: 'cards skill-cards' }, ...SKILL_IDS.map((id) => this.card(world, id))),
    );
  }

  private card(world: World, id: SkillId): HTMLElement {
    const rank = world.player.ranks[id];
    const today = xpTodayOf(world, id);
    return el('div', { class: 'card tile skill-card' },
      el('div', { class: 'card-head' },
        createIcon(SKILL_ICON[id]),
        el('div', { class: 'card-name' }, el('b', {}, SKILL_INFO[id].name), el('span', { class: 'dim' }, `Earns XP from ${SKILL_INFO[id].grows}`)),
        el('div', { class: 'skill-level', title: `Rank ${rank} of ${MAX_RANK}` },
          ...Array.from({ length: MAX_RANK }, (_, i) => el('i', { class: i < rank ? 'on' : '' }))),
      ),
      el('div', { class: 'skill-line' }, el('span', {}, `Rank ${rank}`), this.buy(world, id, rank)),
      el('div', { class: 'skill-line dim' }, el('span', {}, 'Earned today'), el('span', {}, `${Math.floor(today)} / ${XP_RULES.dailyCap} XP`)),
      el('div', { class: 'meter today' }, el('div', { style: `width:${Math.min(today / XP_RULES.dailyCap, 1) * 100}%` })),
      ...this.perks(world, id),
    );
  }

  private buy(world: World, skill: SkillId, rank: number): HTMLElement {
    if (rank >= MAX_RANK) return el('span', {}, 'max');
    const blocked = canBuyRank(world, skill);
    return el('button', {
      class: 'btn-s buy-rank',
      disabled: blocked !== null,
      title: blocked ?? `Spend ${rankCost(rank + 1)} XP on ${SKILL_INFO[skill].name} rank ${rank + 1}`,
      onclick: () => this.host.announce(buyRank(this.host.world(), skill)),
    }, `Buy rank ${rank + 1} — ${rankCost(rank + 1)} XP`);
  }

  private perks(world: World, skill: SkillId): HTMLElement[] {
    const open = pendingPerkPairs(world);
    return PERK_LEVELS.map((level) => perkPair(skill, level)).map((pair) => {
      const picked = pair.perks.find((id) => hasPerk(world, id));
      if (picked) return el('div', { class: 'perk picked' }, el('b', {}, PERKS[picked].name), el('span', {}, PERKS[picked].rule));
      if (open.some((o) => o.skill === pair.skill && o.level === pair.level)) return this.choice(world, pair);
      return el('div', { class: 'perk locked dim' }, `Rank ${pair.level}: ${pair.perks.map((id) => PERKS[id].name).join(' or ')}`);
    });
  }

  private choice(world: World, pair: PerkPair): HTMLElement {
    const canPick = world.player.state === 'active';
    const button = (id: PerkId) => el('button', {
      class: 'perk',
      disabled: !canPick,
      onclick: () => this.host.apply(choosePerk(this.host.world(), id)),
    }, el('b', {}, PERKS[id].name), el('span', {}, PERKS[id].rule));
    return el('div', { class: 'perk-choice' }, el('span', { class: 'good' }, `Rank ${pair.level} perk: pick one`), ...pair.perks.map(button));
  }
}

const SKILL_ICON: Record<SkillId, IconName> = {
  driving: 'wheel',
  perception: 'scanner',
  machining: 'tools',
  toughness: 'armor',
  social: 'money',
};
