import type { Effect, EffectBlock, Trigger } from '@hl/engine';
import { Button, cx, inputCls } from '../ui';
import { ConditionEditor, type Preset } from './ConditionEditor';
import { EffectEditor, type EffectFamily } from './EffectEditor';

export type { Preset };

/** Block timing. `always` blocks contribute while their conditions hold; the others fire once on the event. */
export const TRIGGERS: { id: Trigger; label: string }[] = [
  { id: 'always', label: 'While these hold' }, { id: 'onHit', label: 'When I hit' }, { id: 'onMiss', label: 'When I miss' }, { id: 'onCrit', label: 'When I crit' },
  { id: 'onDamaged', label: 'When I take damage' }, { id: 'onRoundStart', label: 'When a round starts' }, { id: 'onRoundEnd', label: 'When a round ends' },
];

export function familyOf(trigger: Trigger): EffectFamily {
  return trigger === 'always' ? 'while' : 'when';
}

/** `base` if free, else `base-2`, `base-3`, … Ids must not collide: activation ids double as pool ids. */
export function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

function defaultEffect(family: EffectFamily): Effect {
  return family === 'while' ? { verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add' } : { verb: 'tag', to: 'target', tag: 'flanked', duration: 'untilMyNextTurn' };
}

export function newBlock(n: number, taken: string[] = [], family: EffectFamily = 'while'): EffectBlock {
  return { id: uniqueId(`e${n}`, taken), trigger: 'always', when: { all: [] }, do: [defaultEffect(family)] };
}

/**
 * A list of effect blocks. Each block is Timing → If (conditions) → Then (effects); the effect menu follows the timing.
 * `family` forces the timing family when the trigger is implied by the container (an activation's on-use blocks are `when`,
 * its while-active blocks are `while`).
 */
export function BlocksEditor({ value, onChange, showTrigger = true, family: forcedFamily, presets, addLabel = '+ add effect block' }: { value: EffectBlock[]; onChange: (b: EffectBlock[]) => void; showTrigger?: boolean; family?: EffectFamily; presets?: Preset[]; addLabel?: string }) {
  const setBlock = (i: number, patch: Partial<EffectBlock>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const familyFor = (b: EffectBlock) => forcedFamily ?? familyOf(b.trigger);
  return (
    <div className="space-y-3">
      {value.map((b, i) => {
        const family = familyFor(b);
        return (
          <div key={i} data-role="effect-block" className="rounded-2xl border border-zinc-700 bg-zinc-900 p-2">
            <div className="mb-1 flex items-center gap-2">
              {showTrigger ? (
                <select data-role="block-timing" className={cx(inputCls, 'flex-1 py-1.5 text-sm', family === 'when' && 'text-amber-200')} value={b.trigger} onChange={(e) => setBlock(i, { trigger: e.target.value as Trigger })}>{TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              ) : (
                <span className="flex-1 text-xs uppercase tracking-wide text-zinc-500">{forcedFamily === 'when' ? 'When used' : 'While active'}</span>
              )}
              <button type="button" className="px-2 text-zinc-500" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
            </div>
            <input className={inputCls + ' mb-2 py-1.5 text-sm'} placeholder="label (shown in breakdown)" value={b.label ?? ''} onChange={(e) => setBlock(i, { label: e.target.value || undefined })} />
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">If</div>
            <ConditionEditor value={b.when} onChange={(c) => setBlock(i, { when: c })} presets={presets} />
            <div className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Then</div>
            <div className="space-y-1">
              {b.do.map((e, k) => <EffectEditor key={k} value={e} family={family} onChange={(n) => setBlock(i, { do: b.do.map((x, m) => (m === k ? n : x)) })} onRemove={() => setBlock(i, { do: b.do.filter((_, m) => m !== k) })} />)}
              <button type="button" className="text-sm text-amber-300" onClick={() => setBlock(i, { do: [...b.do, defaultEffect(family)] })}>+ add effect</button>
            </div>
          </div>
        );
      })}
      <Button onClick={() => onChange([...value, newBlock(value.length + 1, value.map((b) => b.id), forcedFamily ?? 'while')])}>{addLabel}</Button>
    </div>
  );
}
