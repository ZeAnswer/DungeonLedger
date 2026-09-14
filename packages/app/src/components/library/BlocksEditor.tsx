import type { EffectBlock, Trigger } from '@hl/engine';
import { Button, inputCls } from '../ui';
import { ConditionEditor, type Preset } from './ConditionEditor';
import { EffectEditor } from './EffectEditor';

export type { Preset };

export const TRIGGERS: { id: Trigger; label: string }[] = [
  { id: 'always', label: 'While conditions hold' }, { id: 'onHit', label: 'When I hit' }, { id: 'onMiss', label: 'When I miss' }, { id: 'onCrit', label: 'When I crit' },
  { id: 'onDamaged', label: 'When I take damage' }, { id: 'onRoundStart', label: 'At round start' }, { id: 'onRoundEnd', label: 'At round end' },
];

export function newBlock(n: number): EffectBlock {
  return { id: `e${n}`, trigger: 'always', when: { all: [] }, do: [{ verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add' }] };
}

/** A list of effect blocks. `showTrigger` false = onUse blocks (trigger is implied). */
export function BlocksEditor({ value, onChange, showTrigger = true, presets, addLabel = '+ add effect block' }: { value: EffectBlock[]; onChange: (b: EffectBlock[]) => void; showTrigger?: boolean; presets?: Preset[]; addLabel?: string }) {
  const setBlock = (i: number, patch: Partial<EffectBlock>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-3">
      {value.map((b, i) => (
        <div key={i} className="rounded-2xl border border-zinc-700 bg-zinc-900 p-2">
          <div className="mb-2 flex items-center gap-2">
            <input className={inputCls + ' flex-1'} placeholder="label (shown in breakdown)" value={b.label ?? ''} onChange={(e) => setBlock(i, { label: e.target.value || undefined })} />
            <button type="button" className="px-2 text-zinc-500" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
          {showTrigger && <select className={inputCls + ' mb-2 text-sm'} value={b.trigger} onChange={(e) => setBlock(i, { trigger: e.target.value as Trigger })}>{TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>}
          <div className="mb-1 text-xs text-zinc-400">WHEN</div>
          <ConditionEditor value={b.when} onChange={(c) => setBlock(i, { when: c })} presets={presets} />
          <div className="mb-1 mt-2 text-xs text-zinc-400">DO</div>
          <div className="space-y-1">
            {b.do.map((e, k) => <EffectEditor key={k} value={e} onChange={(n) => setBlock(i, { do: b.do.map((x, m) => (m === k ? n : x)) })} onRemove={() => setBlock(i, { do: b.do.filter((_, m) => m !== k) })} />)}
            <button type="button" className="text-sm text-amber-300" onClick={() => setBlock(i, { do: [...b.do, { verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add' }] })}>+ add effect</button>
          </div>
        </div>
      ))}
      <Button onClick={() => onChange([...value, newBlock(value.length + 1)])}>{addLabel}</Button>
    </div>
  );
}
