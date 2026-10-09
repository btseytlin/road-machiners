import { beforeAll, it } from 'vitest';

beforeAll(() => new Promise<void>(() => undefined));

it('never starts', () => undefined);
