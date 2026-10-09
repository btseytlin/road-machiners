import { MAX_RANK, PERK_LEVELS, PERKS, type PerkId, SKILL_IDS, SKILL_INFO, XP_RULES } from '../data/skills';
import { maxHealthOf } from '../sim/health';
import { buyRank, canBuyRank, choosePerk, hasPerk, pendingPerkPairs, perkPair, type PerkPair, rankCost, xpTodayOf } from '../sim/progress';
import type { SkillId, World } from '../sim/types';
import { createIcon, type IconName } from './cards';
import { disabledWith, el, panel } from './dom';
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
        el('span', { class: 'chip xp-pool', title: 'XP to spend on ranks' }, `${Math.floor(p.xp)} XP`),
      )),
      el('div', { class: 'skill-table' },
        el('div', { class: 'skill-head' },
          el('span', { class: 'skill-name-col' }, 'Skill'),
          el('span', {}, 'Rank'),
          ...PERK_LEVELS.map((level) => el('span', {}, `Rank ${level} perk`)),
          el('span', {}, `Today, max ${XP_RULES.dailyCap} XP`),
          el('span', {}),
        ),
        ...SKILL_IDS.map((id) => this.row(world, id)),
      ),
    );
  }

  private row(world: World, id: SkillId): HTMLElement {
    const rank = world.player.ranks[id];
    const today = Math.floor(xpTodayOf(world, id));
    const open = pendingPerkPairs(world).filter((pair) => pair.skill === id);
    return el('div', { class: `skill-row${open.length > 0 ? ' pending' : ''}` },
      el('span', { class: 'skill-name', title: `Earns XP from ${SKILL_INFO[id].grows}` }, createIcon(SKILL_ICON[id]), SKILL_INFO[id].name),
      el('div', { class: 'skill-level', title: `Rank ${rank} of ${MAX_RANK}` },
        ...Array.from({ length: MAX_RANK }, (_, i) => el('i', { class: i < rank ? 'on' : '' }))),
      ...PERK_LEVELS.map((level) => this.perkCell(world, perkPair(id, level), open.some((o) => o.level === level))),
      el('div', { class: 'skill-today' },
        el('div', { class: 'meter progress' }, el('div', { style: `width:${Math.min(today / XP_RULES.dailyCap, 1) * 100}%` })),
        el('span', { class: `num${today === 0 ? ' dim' : ''}` }, String(today))),
      this.buy(world, id, rank),
    );
  }

  private buy(world: World, skill: SkillId, rank: number): HTMLElement {
    if (rank >= MAX_RANK) return el('span', { class: 'skill-buy dim' }, 'Max');
    const blocked = canBuyRank(world, skill);
    return el('button', {
      class: 'btn-s skill-buy buy-rank',
      ...disabledWith(blocked, () => this.host.announce(buyRank(this.host.world(), skill))),
    }, `Buy ${rankCost(rank + 1)} XP`);
  }

  private perkCell(world: World, pair: PerkPair, isOpen: boolean): HTMLElement {
    const picked = pair.perks.find((id) => hasPerk(world, id));
    if (picked) return el('div', { class: 'perk-cell picked', title: PERKS[picked].rule }, PERKS[picked].name);
    if (isOpen) return this.choice(world, pair);
    return el('div', { class: 'perk-cell locked' },
      ...pair.perks.map((id) => el('span', { title: PERKS[id].rule }, PERKS[id].name)));
  }

  private choice(world: World, pair: PerkPair): HTMLElement {
    const reason = world.player.state === 'active' ? null : `You are ${world.player.state === 'dead' ? 'dead' : 'knocked out'}`;
    const button = (id: PerkId) => el('button', {
      class: 'perk',
      ...disabledWith(reason, () => this.host.apply(choosePerk(this.host.world(), id))),
    }, el('b', {}, PERKS[id].name), el('span', {}, PERKS[id].rule));
    return el('div', { class: 'perk-cell perk-choice' }, ...pair.perks.map(button));
  }
}

const SKILL_ICON: Record<SkillId, IconName> = {
  driving: 'wheel',
  perception: 'scanner',
  machining: 'tools',
  toughness: 'armor',
  social: 'trade',
};
