import { ENGINE_VERSION } from '../src';
test('engine loads', () => { expect(ENGINE_VERSION).toBe('0.1.0'); });
import * as E from '../src/index';
test('index re-exports resolve, scripts and resources without ambiguity', () => {
  for (const n of ['resolveStat', 'resolveAttack', 'availableActions', 'computePass', 'runEventScripts', 'applyPatches', 'changeResource', 'findPer', 'newSink', 'toRounds', 'slotCapacity', 'nameOf', 'describeSelector', 'setStatResolver', 'clearComputeCache', 'diagnostics', 'ROUND', 'HURT', 'SIZE']) {
    expect((E as Record<string, unknown>)[n], n).toBeDefined();
  }
  expect((E as Record<string, unknown>)['evalCondition']).toBeUndefined();
});
