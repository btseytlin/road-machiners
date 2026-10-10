import { ECONOMY } from '../../data/goods';
import { partDef } from '../../data/parts';
import { inCombat } from '../combat';
import { hostileToPlayer, playerCanAct, setAutoFire, setAutoRepair, setMoveOrder } from '../world';
import { basicsRepairCost, repairCost, supplyRoom, type Supply } from '../economy';
import { abandonRun, canAbandonRun, canWaitForRoad, nextOutpost, payOf, reachedOutpostAt, waitForRoad, type Outpost } from '../fury-road';
import { corePart, goodsCount, mountedParts } from '../grid';
import { canStowPart, installSpot } from '../inventory';
import { outpostBuyGood, outpostBuyPart, outpostBuySupply, outpostGoodPrice, outpostGoodRoom, outpostPartPrice, outpostRepairAll, outpostRepairBasics } from '../outposts';
import type { PartInstance, Vehicle, World } from '../types';
import { dist, type Vec } from '../vec';
import { playerSees } from '../vision';
import { isJunk, partValue } from '../wear';
import { aimGuns } from './aim';
import { probe } from './gear';
import { mountBought, Orders, type BotTurn } from './orders';

const PATCH_GOODS = 4;
const SUPPLIES: readonly Supply[] = ['fuel', 'supplies'];

export function runnerOrders(world: World): BotTurn {
  const o = new Orders(world);
  if (playerCanAct(o.world)) run(o);
  return { world: o.world, events: o.events, ledger: o.ledger, notes: o.notes };
}

function run(o: Orders): void {
  keepSwitches(o);
  if (o.me.job) return;
  const post = reachedOutpostAt(o.world);
  if (post) restock(o, post);
  if (canWaitForRoad(o.world)) o.run(waitForRoad);
  if (canAbandonRun(o.world) && !canPatchOn(o.world, o.me)) return o.run(abandonRun);
  drive(o);
}

function keepSwitches(o: Orders): void {
  if (!o.world.player.autoRepair) o.run((w) => setAutoRepair(w, true));
  if (!o.world.player.autoFire) o.run((w) => setAutoFire(w, true));
  const foe = nearestFoe(o.world, o.me);
  if (foe) aimGuns(o, foe);
}

function drive(o: Orders): void {
  const foe = nearestFoe(o.world, o.me);
  const next = nextOutpost(o.world);
  if (foe && inCombat(o.world, o.me)) driveTo(o, foe.pos);
  else if (next) driveTo(o, next.pad);
  else if (o.me.order) o.run((w) => setMoveOrder(w, null));
}

function nearestFoe(world: World, me: Vehicle): Vehicle | null {
  const foes = world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v) && playerSees(world, v.pos));
  return foes.sort((a, b) => dist(me.pos, a.pos) - dist(me.pos, b.pos))[0] ?? null;
}

function canPatchOn(world: World, me: Vehicle): boolean {
  if (world.player.fuel <= 0) return false;
  const drive = [...mountedParts(me, 'engine').slice(0, 1), corePart(me, 'transmission')];
  return (goodsCount(me).parts ?? 0) > 0 && drive.length === 2 && drive.every((part) => !isJunk(part));
}

function restock(o: Orders, post: Outpost): void {
  repair(o);
  for (const kind of SUPPLIES) topUp(o, kind);
  buyPatchGoods(o);
  if (!inCombat(o.world, o.me)) buyBestPart(o, post);
}

function repair(o: Orders): void {
  const all = repairCost(o.world);
  const basics = basicsRepairCost(o.world);
  if (all > 0 && all <= o.world.player.money) o.run(outpostRepairAll, 'repairs');
  else if (basics > 0 && basics <= o.world.player.money) o.run(outpostRepairBasics, 'repairs');
}

function topUp(o: Orders, kind: Supply): void {
  const n = Math.min(supplyRoom(o.world, kind), Math.floor(o.world.player.money / ECONOMY.supplyPrice[kind]));
  if (n > 0) o.run((w) => outpostBuySupply(w, kind, n), kind);
}

function buyPatchGoods(o: Orders): void {
  const want = PATCH_GOODS - (goodsCount(o.me).parts ?? 0);
  const n = Math.min(want, outpostGoodRoom(o.me), Math.floor(o.world.player.money / outpostGoodPrice()));
  if (n > 0) o.run((w) => outpostBuyGood(w, n), 'goodsBought');
}

function buyBestPart(o: Orders, post: Outpost): void {
  const reserve = payOf((o.world.furyRoad?.window ?? 0) + 1, 0);
  const fits = post.stock.filter((part) => mountable(o, part) && outpostPartPrice(o.world, part) <= o.world.player.money - reserve);
  const best = fits.sort((a, b) => partValue(b) - partValue(a))[0];
  if (!best) return;
  o.run((w) => outpostBuyPart(w, best.id), 'gear');
  const held = o.me.items.find((it): it is Extract<typeof it, { kind: 'part' }> => it.kind === 'part' && it.part.id === best.id);
  const spot = held ? installSpot(o.me, held) : null;
  if (spot) mountBought(o, best.id, spot);
}

function mountable(o: Orders, part: PartInstance): boolean {
  return !isJunk(part) && partDef(part.defId).kind !== 'core' && canStowPart(o.me, part) && installSpot(o.me, probe(part)) !== null;
}

function driveTo(o: Orders, dest: Vec): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && order.dest.x === dest.x && order.dest.y === dest.y) return;
  o.run((w) => setMoveOrder(w, { kind: 'stopAt', dest }));
}
