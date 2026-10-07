// Character screen: the XP pool, and per skill its rank, a button that buys the next rank, today's XP of its activity
// family against the daily cap, and perks. An open perk pair shows both perks as buttons, a picked pair shows its perk
// and a pair above the rank shows what it needs.

import { MAX_RANK, PERK_LEVELS, type PerkId, SKILL_IDS, XP_RULES } from '../data/skills';
import { maxHealthOf } from '../sim/health';
import { buyRank, canBuyRank, choosePerk, hasPerk, pendingPerkPairs, perkPair, type PerkPair, rankCost, xpTodayOf } from '../sim/progress';
import type { SkillId, World } from '../sim/types';
import { createIcon, type IconName } from './cards';
import { el, panel } from './dom';
import type { UiHost } from './host';
import { hp } from './units';
import { t } from '../text/msg';
import { perkName, perkRule, refusalText, skillGrows, skillName } from '../text/names';

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

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const world = this.host.world();
    const p = world.player;
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, t('character.close')),
      el('h3', {}, t('character.title'), el('span', { class: 'chips' },
        el('span', { class: 'chip', title: t('character.health') }, createIcon('driver'), t('readout.ofMax', { n: hp(p.health), max: maxHealthOf(world) })),
        el('span', { class: 'chip', title: t('character.knockoutsTitle') }, createIcon('damage'), t('character.knockouts', { n: p.knockouts })),
        el('span', { class: 'chip xp-pool', title: t('character.xpTitle') }, t('character.xp', { n: Math.floor(p.xp) })),
      )),
      el('div', { class: 'cards skill-cards' }, ...SKILL_IDS.map((id) => this.card(world, id))),
    );
  }

  private card(world: World, id: SkillId): HTMLElement {
    const rank = world.player.ranks[id];
    const today = xpTodayOf(world, id);
    return el('div', { class: 'card skill-card' },
      el('div', { class: 'card-head' },
        createIcon(SKILL_ICON[id]),
        el('div', { class: 'card-name' }, el('b', {}, skillName(id)), el('span', { class: 'dim' }, t('character.grows', { what: skillGrows(id) }))),
        el('div', { class: 'skill-level', title: t('character.rankOf', { rank, max: MAX_RANK }) },
          ...Array.from({ length: MAX_RANK }, (_, i) => el('i', { class: i < rank ? 'on' : '' }))),
      ),
      el('div', { class: 'skill-line' }, el('span', {}, t('character.rank', { rank })), this.buy(world, id, rank)),
      el('div', { class: 'skill-line dim' }, el('span', {}, t('character.today')), el('span', {}, t('character.todayXp', { n: Math.floor(today), cap: XP_RULES.dailyCap }))),
      el('div', { class: 'meter today' }, el('div', { style: `width:${Math.min(today / XP_RULES.dailyCap, 1) * 100}%` })),
      ...this.perks(world, id),
    );
  }

  // The button that buys the next rank, disabled with its reason when it cannot, or "max" at the top rank.
  private buy(world: World, skill: SkillId, rank: number): HTMLElement {
    if (rank >= MAX_RANK) return el('span', {}, t('character.max'));
    const blocked = canBuyRank(world, skill);
    const next = { rank: rank + 1, cost: rankCost(rank + 1) };
    return el('button', {
      class: 'buy-rank',
      disabled: blocked !== null,
      title: blocked ? refusalText(world, blocked) : t('character.spendTitle', { ...next, skill: skillName(skill) }),
      onclick: () => this.host.announce(buyRank(this.host.world(), skill)),
    }, t('character.buy', next));
  }

  // One line per perk pair: the picked perk, both perks as buttons once the rank is reached, or what it needs.
  private perks(world: World, skill: SkillId): HTMLElement[] {
    const open = pendingPerkPairs(world);
    return PERK_LEVELS.map((level) => perkPair(skill, level)).map((pair) => {
      const picked = pair.perks.find((id) => hasPerk(world, id));
      if (picked) return el('div', { class: 'perk picked' }, el('b', {}, perkName(picked)), el('span', {}, perkRule(picked)));
      if (open.some((o) => o.skill === pair.skill && o.level === pair.level)) return this.choice(world, pair);
      const [a, b] = pair.perks;
      return el('div', { class: 'perk locked dim' }, t('character.locked', { rank: pair.level, a: perkName(a), b: perkName(b) }));
    });
  }

  private choice(world: World, pair: PerkPair): HTMLElement {
    const canPick = world.player.state === 'active';
    const button = (id: PerkId) => el('button', {
      class: 'perk',
      disabled: !canPick,
      onclick: () => this.host.apply(choosePerk(this.host.world(), id)),
    }, el('b', {}, perkName(id)), el('span', {}, perkRule(id)));
    return el('div', { class: 'perk-choice' }, el('span', { class: 'good' }, t('character.pick', { rank: pair.level })), ...pair.perks.map(button));
  }
}

const SKILL_ICON: Record<SkillId, IconName> = {
  driving: 'wheel',
  perception: 'scanner',
  machining: 'tools',
  toughness: 'armor',
  social: 'money',
};
