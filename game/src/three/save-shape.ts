// The shape of a save: every key and value type, with the values left out. save-shape.json holds the shape of the
// current format, so a test catches a change to the saved shape that no new save format covers.

export type Shape = string | Shape[] | { [key: string]: Shape };

export function shapeOf(value: unknown): Shape {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const shapes = new Map(value.map((item) => { const shape = shapeOf(item); return [JSON.stringify(shape), shape]; }));
    return [...shapes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, shape]) => shape);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf((value as Record<string, unknown>)[key])]));
  }
  return typeof value;
}
