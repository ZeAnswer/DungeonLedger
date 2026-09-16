/** Thrown by `Budget.tick` when a script's compute budget (time or operation count) is exceeded. */
export class ScriptTimeout extends Error {}

/**
 * A per-run compute budget. `start(ms)` resets it; `tick` is called from every instrumented loop
 * iteration and function entry (see `instrument.ts`) and throws once the script overstays its welcome.
 * `tick` is an arrow property so it can be detached and passed as a bare callback (`c.run(api, b.tick)`).
 */
export class Budget {
  private ops = 0;
  private t0 = 0;
  private limit = 0;

  start(ms: number) {
    this.ops = 0;
    this.t0 = performance.now();
    this.limit = ms;
  }

  tick = () => {
    if ((++this.ops & 255) === 0 && performance.now() - this.t0 > this.limit) {
      throw new ScriptTimeout(`script exceeded ${this.limit} ms (${this.ops} ops)`);
    }
    if (this.ops > 2_000_000) throw new ScriptTimeout('script exceeded 2,000,000 operations');
  };
}
