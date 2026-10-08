import type { RunnerTestCase, RunnerTaskEventPack, RunnerTaskResultPack } from 'vitest';
import { VitestTestRunner } from 'vitest/runners';
import { getFn } from 'vitest/suite';

type TaskUpdate = (packs: RunnerTaskResultPack[], events: RunnerTaskEventPack[]) => Promise<void>;

export default class SettledRunner extends VitestTestRunner {
  private readonly pending = new Set<Promise<void>>();
  private sendUpdate: TaskUpdate | undefined;

  constructor(...args: ConstructorParameters<typeof VitestTestRunner>) {
    super(...args);
    Object.defineProperty(this, 'onTaskUpdate', {
      configurable: true,
      get: () => this.sendUpdate,
      set: (send: TaskUpdate) => {
        this.sendUpdate = (packs, events) => {
          const reply = send(packs, events);
          this.pending.add(reply);
          reply.then(() => this.pending.delete(reply), () => this.pending.delete(reply));
          return reply;
        };
      },
    });
  }

  async runTask(test: RunnerTestCase): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
    await getFn(test)();
  }
}
