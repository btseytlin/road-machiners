import { EMPTY_STATE, updateState } from './state';
import type { FactoryState } from './types';

type Tree = Record<string, unknown>;

const kindOf = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

const isMapStore = (store: string): boolean => kindOf(EMPTY_STATE[store as keyof FactoryState]) === 'object';

export function setPath(state: FactoryState, path: string, value: unknown): FactoryState {
  const keys = path.split('.');
  if (keys.some((key) => key === '')) throw new Error(`"${path}" is not a state path. Use dotted keys, like release.postId.`);
  if (!Object.hasOwn(state, keys[0])) throw new Error(`The state has no store "${keys[0]}". docs/state.md lists the stores.`);
  if (value === undefined) requireMapEntry(keys, path);
  else requireSameKind(valueAt(state, path), value, path);
  return setIn(state as unknown as Tree, keys, value) as unknown as FactoryState;
}

function requireMapEntry(keys: string[], path: string): void {
  if (keys.length !== 2 || !isMapStore(keys[0])) throw new Error(`Only an entry of a map store, like pendingApprovals.5, can be deleted. Set "${path}" to a value instead.`);
}

function requireSameKind(before: unknown, value: unknown, path: string): void {
  if (before === undefined || before === null || value === null) return;
  if (kindOf(before) !== kindOf(value)) throw new Error(`"${path}" holds a ${kindOf(before)}, not a ${kindOf(value)}.`);
}

function setIn(tree: Tree, [key, ...rest]: string[], value: unknown): Tree {
  const copy: Tree = Array.isArray(tree) ? ([...tree] as unknown as Tree) : { ...tree };
  if (rest.length === 0) {
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    return copy;
  }
  const child = copy[key];
  if (child === null || typeof child !== 'object') throw new Error(`"${key}" holds no object to go into.`);
  copy[key] = setIn(child as Tree, rest, value);
  return copy;
}

export function editState(statePath: string, path: string, json: string | null): { before: unknown; after: unknown } {
  const value = json === null ? undefined : (JSON.parse(json) as unknown);
  let before: unknown;
  updateState(statePath, (state) => {
    before = valueAt(state, path);
    return setPath(state, path, value);
  });
  return { before, after: value };
}

function valueAt(state: FactoryState, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node !== null && typeof node === 'object' ? (node as Tree)[key] : undefined), state);
}
