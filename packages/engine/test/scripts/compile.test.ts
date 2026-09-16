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

test('battle.on(...) calls are scanned as toggles too, the same as battle.toggles.<name> reads', () => {
  expect(instrument("if (battle.toggles.a) {}").toggles).toEqual(['a']);
  expect(instrument("if (battle.on('b')) {}").toggles).toEqual(['b']);
  expect(instrument("if (battle.toggles.a) {}\nif (battle.on('b')) {}").toggles.sort()).toEqual(['a', 'b']);
});

test('battle.on(<identifier>) is not a literal toggle, but is noted as a toggle-identifier candidate; compile() keeps only the ones that are compiled param names', () => {
  const r = instrument('if (battle.on(switchName)) bonus(stat, amount)');
  expect(r.toggles).toEqual([]);
  expect(r.toggleIdentifiers).toEqual(['switchName']);
  // A shared function's own source can never know the switch's name (it's the caller's argument) — that's
  // exactly what `toggleParams` records, so `collectToggles` can still discover it from a literal call arg.
  const c = compile('if (battle.on(switchName)) bonus(stat, amount)', ['stat', 'amount', 'switchName']);
  expect(c.ok).toBe(true);
  if (c.ok) { expect(c.toggles).toEqual([]); expect(c.toggleParams).toEqual(['switchName']); }
  // An identifier that isn't a compiled param at all contributes nothing: it can never be resolved to a value.
  const noParams = compile('if (battle.on(switchName)) bonus(stat, amount)');
  if (noParams.ok) expect(noParams.toggleParams).toEqual([]);
});

test('@noguard is read from real comments, not from a string that merely contains the text', () => {
  expect(instrument("note('// @noguard'); while (true) {}").noguard).toBe(false);
  expect(instrument("note('// @noguard'); while (true) {}").code).toContain('__g()');
  expect(instrument('/* @noguard */\nwhile (true) {}').noguard).toBe(true);
});

test('__g and api cannot be declared: shadowing the runtime\'s own parameters would disable the guard silently (var does not raise "already declared")', () => {
  expect(() => instrument('var __g = () => 0; while (true) {}')).toThrow(/__g/);
  expect(() => instrument('var api = 1;')).toThrow(/api/);
  expect(() => instrument('const { __g } = {};')).toThrow(/__g/);
  expect(() => instrument('function api() {}')).toThrow(/api/);
  expect(() => instrument('bonus("attack", 1);')).not.toThrow();
});

test('compile caches, reports syntax errors with a line, and runs with the destructured api', () => {
  const bad = compile('bonus(1,'); expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error).toMatch(/Unexpected/);
  const good = compile("bonus('attack', 2)"); expect(good.ok).toBe(true);
  const calls: unknown[] = []; if (good.ok) good.run({ bonus: (...a: unknown[]) => calls.push(a) } as never, () => {});
  expect(calls).toEqual([['attack', 2]]);
  expect(compile("bonus('attack', 2)")).toBe(good);
  const shadow = compile('const bonus = 1'); expect(shadow.ok).toBe(false); if (!shadow.ok) expect(shadow.error).toMatch(/bonus/);
  // `var __g = ...` doesn't raise a "already declared" error (var may re-bind a parameter) and would
  // otherwise silently swap out the loop guard; compile() must still reject it.
  const noBudget = compile('var __g = () => 0; while (true) {}'); expect(noBudget.ok).toBe(false); if (!noBudget.ok) expect(noBudget.error).toMatch(/__g/);
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
