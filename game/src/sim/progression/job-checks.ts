// What each bot exists to do, and the least it must do per in-game day. A bot below its floor is not playing its job,
// so its run fails with the reason instead of reporting a balance number that the bot's idleness made. A floor is half
// the lowest rate of the saved 5-day runs of the bot that played its job, so it catches a bot that does not work, and
// tunes nothing. The hunter's floor sits between its 2-gun runs, at 26 to 43 rounds a day, and its 1-gun runs, at 3 to 9.
// The climber and the markov bot switch jobs, so no floor fits them.

import { TIME } from '../../data/time';
import type { Archetype } from './bot';
import type { TurnLine } from './turn-log';

type Tally = { shots: number; saleTurns: number; contractMoney: number };

// grace is the days a bot gets before its rate counts, so the start of a run does not fail a slow first trip. A
// contract pays on delivery, in lumps, so the hauler gets longer.
type Job = { what: string; floor: number; grace: number; read: (t: Tally) => number };

const JOBS: Partial<Record<Archetype, Job>> = {
  hunter: { what: 'rounds fired by the player', floor: 12, grace: 3, read: (t) => t.shots },
  trader: { what: 'turns with a sale', floor: 0.5, grace: 3, read: (t) => t.saleTurns },
  fastTrader: { what: 'turns with a sale', floor: 0.5, grace: 3, read: (t) => t.saleTurns },
  scavenger: { what: 'turns with a sale', floor: 2, grace: 3, read: (t) => t.saleTurns },
  hauler: { what: 'money from contracts', floor: 75, grace: 5, read: (t) => t.contractMoney },
};

// The player's own rounds: a shot whose shooter is a truck of the player faction.
const PLAYER_SHOT = /^shot [^>]*:player\//;

export class JobTally {
  private readonly tally: Tally = { shots: 0, saleTurns: 0, contractMoney: 0 };
  private turns = 0;

  note(line: TurnLine): void {
    this.turns++;
    this.tally.shots += line.ev.filter((e) => PLAYER_SHOT.test(e)).length;
    if ((line.ledger.goodsSold ?? 0) + (line.ledger.lootSales ?? 0) > 0) this.tally.saleTurns++;
    this.tally.contractMoney += line.ledger.contracts ?? 0;
  }

  // Why the bot is not doing its job, or null. It only judges whole days after the grace days.
  failure(archetype: Archetype): string | null {
    const job = JOBS[archetype];
    const days = this.turns / TIME.turnsPerDay;
    if (!job || days < job.grace || this.turns % TIME.turnsPerDay !== 0) return null;
    const rate = job.read(this.tally) / days;
    if (rate >= job.floor) return null;
    return `${archetype} does not play its job: ${rate.toFixed(1)} ${job.what} per day over ${days} days, floor ${job.floor}`;
  }
}
