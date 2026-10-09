import { it } from 'vitest';

it('waits forever on a promise', () => new Promise<void>(() => undefined));
