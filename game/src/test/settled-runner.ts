import type { RunnerTestCase, RunnerTaskEventPack, RunnerTaskResultPack } from 'vitest';
import { VitestTestRunner } from 'vitest/runners';
import { getFn } from 'vitest/suite';

type TaskUpdate = (packs: RunnerTaskResultPack[], events: RunnerTaskEventPack[]) => Promise<void>;

// A worker's status message to the runner times out when its reply waits more than vitest's fixed 60 s,
// and a reply cannot land while a synchronous test holds the event loop. On a loaded machine many
// simulation tests run longer than that without a yield, so each test body starts only once every
// status message sent so far has its reply.
export default class SettledRunner extends VitestTestRunner {
  private readonly pending = new Set<Promise<void>>();
  private sendUpdate: TaskUpdate | undefined;

  constructor(...args: ConstructorParameters<typeof VitestTestRunner>) {
    super(...args);
    // Vitest assigns its own RPC-sending onTaskUpdate after construction. Keep each promise it returns.
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
