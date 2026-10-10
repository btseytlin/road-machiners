export class PlayClock {
  private totalMs = 0;
  private thisFrameMs = 0;
  private rate = 0;
  private played = false;

  constructor(private readonly easeMs: number) {
    if (!(easeMs > 0)) throw new Error(`The play clock needs a positive ease time, got ${easeMs} ms`);
  }

  beginFrame(): void {
    this.thisFrameMs = 0;
    this.played = false;
  }

  advance(ms: number): void {
    this.add(ms);
    this.played = true;
    this.rate = 1;
  }

  coast(realMs: number, wanted: boolean, speed: number): void {
    if (this.played) return;
    const step = realMs / this.easeMs;
    this.rate = wanted ? Math.min(1, this.rate + step) : Math.max(0, this.rate - step);
    this.add(realMs * speed * this.rate * this.rate * (3 - 2 * this.rate));
  }

  private add(ms: number): void {
    if (!(ms >= 0)) throw new Error(`Play time only moves forward, got ${ms} ms`);
    this.thisFrameMs += ms;
    this.totalMs += ms;
  }

  nowMs(): number {
    return this.totalMs;
  }

  frameMs(): number {
    return this.thisFrameMs;
  }
}
