import { compile } from '../../src/scripts/compile';
import { instrument } from '../../src/scripts/instrument';
import { Budget, ScriptTimeout } from '../../src/scripts/budget';
import { diagnostics } from '../../src/scripts/diagnostics';

test('instrument splices guards into loops and functions and scans toggles and emits', () => {
  const r = instrument("for (let i = 0; i < 3; i++) x++; while (a) { b() }\nfunction f() { return 1 }\nif (battle.toggles.sniping) emit('rage-ended')");
  expect(r.code).toContain('for (let i = 0; i < 3; i++) {__g();x++;}');
  expect(r.code).toContain('while (a) {__g(); b() }');
  expect(r.code).toContain('function f() {__g(); return 1 }');
  expect(r.toggles).toEqual(['sniping']); expect(r.emits).toEqual(['rage-ended']); expect(r.noguard).toBe(false);
  expect(instrument('// @noguard\nwhile (x) {}').code).toBe('// @noguard\nwhile (x) {}');
});

test('compile caches, reports syntax errors with a line, and runs with the destructured api', () => {
  const bad = compile('bonus(1,'); expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error).toMatch(/Unexpected/);
  const good = compile("bonus('attack', 2)"); expect(good.ok).toBe(true);
  const calls: unknown[] = []; if (good.ok) good.run({ bonus: (...a: unknown[]) => calls.push(a) } as never, () => {});
  expect(calls).toEqual([['attack', 2]]);
  expect(compile("bonus('attack', 2)")).toBe(good);
  const shadow = compile('const bonus = 1'); expect(shadow.ok).toBe(false); if (!shadow.ok) expect(shadow.error).toMatch(/bonus/);
});

test('budget stops a runaway loop', () => {
  const c = compile('while (true) {}'); expect(c.ok).toBe(true);
  const b = new Budget(); b.start(5);
  expect(() => { if (c.ok) c.run({} as never, b.tick); }).toThrow(ScriptTimeout);
});

test('diagnostics quarantine after three failures', () => {
  diagnostics.clear();
  for (let i = 0; i < 3; i++) diagnostics.noteFailure('rec/s1');
  expect(diagnostics.quarantined('rec/s1')).toBe(true); expect(diagnostics.quarantined('rec/s2')).toBe(false);
});
