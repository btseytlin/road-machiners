import { it } from 'vitest';
import { budget } from '../../budget';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

it('finishes past the default limit under its own budget', () => sleep(1_500), budget(5_000));
