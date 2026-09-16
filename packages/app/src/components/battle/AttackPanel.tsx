import { useMemo, useState } from 'react';
import {
  attackProfiles, availableActions, listAttackModes, logAttack, resolveAttack, setPrompt, undoEvent, useAbility, type ActionInfo, type AttackResult, type BreakdownEntry, type EvalContext, type PromptRequest,
} from '@hl/engine';
import { useStore } from '../../store/store';
import { collectToggles } from '../../store/hooks';
import { usePathLongPress } from '../../hooks/usePathLongPress';
import { Button, Chip, Field, Sheet, cx, humanize, inputCls, signed } from '../ui';

export function AttackPanel({ ctx }: { ctx: EvalContext }) {
  const setBattle = useStore((s) => s.setBattle);
  const applyState = useStore((s) => s.applyState);
  const showToast = useStore((s) => s.showToast);
  const battle = ctx.battle!;
  const target = ctx.target;
  const profiles = useMemo(() => attackProfiles(ctx), [ctx]);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const effectiveProfileId = profiles.some((p) => p.id === profileId) ? profileId : profiles[0]?.id ?? '';
  const modes = useMemo(() => listAttackModes(ctx, effectiveProfileId), [ctx, effectiveProfileId]);
  const [modeId, setModeId] = useState('full');
  const mode = modes.find((m) => m.modeId === modeId) ?? modes[1] ?? modes[0];
  const [expanded, setExpanded] = useState<number | undefined>();
  const [prompt, setPromptOpen] = useState<{ id: string; category?: string } | undefined>();

  const result = useMemo(() => (mode && profiles.length ? resolveAttack(ctx, { profileId: effectiveProfileId, modeId: mode.modeId }) : undefined), [ctx, effectiveProfileId, mode, profiles.length]);
  const toggles = useMemo(() => collectToggles(ctx), [ctx]);
  const actions = useMemo(() => availableActions(ctx), [ctx]);
  const declares = useMemo(() => actions.filter((a) => a.declare), [actions]);

  const setToggle = (id: string, v: boolean) => setBattle({ ...battle, toggles: { ...battle.toggles, [id]: v } });
  const record = (a: AttackResult, res: 'hit' | 'miss' | 'crit') => {
    if (!target) return;
    const damageText = `${a.damage.dice.map((d) => d.dice).join(' + ')}${a.damage.flat ? ` ${signed(a.damage.flat)}` : ''}`;
    const r = logAttack(ctx, { targetId: target.id, profileId: effectiveProfileId, modeId: mode!.modeId, attackIndex: a.index, result: res }, { attackBonus: a.attackBonus, damageText });
    applyState(r);
    showToast(`#${a.index} ${res.toUpperCase()} vs ${target.name}`);
  };
  const use = (a: ActionInfo) => {
    const r = useAbility(ctx, { abilityId: a.abilityId, activationId: a.activationId, ...(target ? { targetId: target.id } : {}) });
    applyState(r);
    showToast(`Used ${a.name}`);
  };

  const originLabel = (a: ActionInfo) => a.kind === 'feature' && a.acquired?.kind === 'class'
    ? `${ctx.library.classTables[a.acquired.classId ?? '']?.name ?? 'class feature'}${a.acquired.level ? ` ${a.acquired.level}` : ''}`
    : a.name !== a.recordName ? a.recordName
    : a.kind === 'feature' ? ({ feat: 'feat', race: 'racial', dm: 'DM' } as Record<string, string>)[a.acquired?.kind ?? 'feat'] ?? 'feature'
    : a.kind;
  if (!profiles.length) return <p className="text-zinc-500">No weapon equipped. Equip one in Inventory.</p>;

  return (
    <div>
      {/* toggles */}
      {(toggles.length > 0 || declares.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {toggles.map((t) => <ToggleChip key={t.id} id={t.id} on={!!battle.toggles[t.id]} onToggle={() => setToggle(t.id, !battle.toggles[t.id])} />)}
          {declares.map((a) => (
            <Chip key={a.activationId} tone="red" active={a.active} className={cx(!a.usable && 'opacity-60')} onClick={() => !a.active && a.usable && use(a)}>
              ⚡ {a.name}{a.charges ? ` ${a.charges.remaining}/${a.charges.max}` : ''}
            </Chip>
          ))}
        </div>
      )}

      {/* profile + mode */}
      <div className="mb-2 flex flex-wrap gap-2">
        {profiles.map((p) => <Chip key={p.id} active={p.id === effectiveProfileId} onClick={() => { setProfileId(p.id); setModeId('full'); }}>{p.kind === 'ranged' ? '🏹' : '🗡️'} {p.name}</Chip>)}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {modes.map((m) => <Chip key={m.modeId} tone="blue" active={m.modeId === mode?.modeId} onClick={() => setModeId(m.modeId)}>{m.label}</Chip>)}
      </div>

      {!target && <p className="mb-3 rounded-xl border border-dashed border-zinc-700 p-3 text-center text-sm text-zinc-400">Tap a combatant above to target it. Numbers below assume no target.</p>}

      {result && result.promptsNeeded.length > 0 && (
        <div className="mb-3 space-y-1">
          {result.promptsNeeded.map((p) => <PromptRow key={p.source + p.promptId} request={p} label={`${p.sourceName}: roll ${humanize(p.promptId)}${p.tag ? ` vs ${ctx.library.tags[p.tag]?.label ?? p.tag}` : ''}`} disabled={!!p.perTagCategory && !p.tag} onOpen={() => setPromptOpen({ id: p.promptId, ...(p.perTagCategory ? { category: p.perTagCategory } : {}) })} />)}
        </div>
      )}
      {result && result.warnings.filter((w) => !result.promptsNeeded.some((p) => w.startsWith(p.sourceName))).map((w) => <div key={w} className="mb-2 rounded-xl border border-amber-900 px-3 py-2 text-sm text-amber-200">⚠️ {w}</div>)}

      {/* attacks */}
      {result && (
        <div className="space-y-2">
          {result.attacks.map((a) => {
            const logged = battle.log.find((e) => e.kind === 'attack' && e.round === battle.round && e.targetId === target?.id && e.modeId === mode?.modeId && e.attackIndex === a.index && e.profileId === effectiveProfileId);
            if (logged) {
              // Executed: frozen at the numbers it was rolled with; only Undo can change it.
              return (
                <div key={a.index} data-attack={a.index} className={cx('flex w-full items-center justify-between rounded-2xl border bg-zinc-950 px-3 py-2 opacity-80', logged.result === 'miss' ? 'border-red-900' : 'border-emerald-800')}>
                  <span className="min-w-0">
                    <span className="text-xs text-zinc-500">#{a.index}</span>
                    <span className={cx('ml-2 font-bold', logged.result === 'miss' ? 'text-red-300' : 'text-emerald-300')}>{logged.result!.toUpperCase()}</span>
                    {logged.snapshot && <span className="ml-3 text-sm text-zinc-400">{signed(logged.snapshot.attackBonus)} · {logged.snapshot.damageText}</span>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => { const r = undoEvent(ctx, logged.id); applyState(r); showToast(`Undid attack #${a.index}`); }}>Undo</Button>
                </div>
              );
            }
            return (
              <div key={a.index} data-attack={a.index} className="rounded-2xl border border-zinc-700 bg-zinc-900 p-3">
                <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(expanded === a.index ? undefined : a.index)}>
                  <div>
                    <span className="text-xs text-zinc-500">#{a.index}</span>
                    <span className="ml-2 text-2xl font-bold tabular-nums">{signed(a.attackBonus)}</span>
                    <span className="ml-3 text-lg">{a.damage.dice.map((d) => d.dice).join(' + ')}{a.damage.flat ? ` ${signed(a.damage.flat)}` : ''}</span>
                    <span className="ml-2 text-xs text-zinc-500">crit {a.critRange === 20 ? '20' : `${a.critRange}-20`} ×{a.critMult}{a.ignoreConcealment ? ' · ignores concealment' : ''}</span>
                  </div>
                  <span className="text-zinc-500">{expanded === a.index ? '▲' : '▼'}</span>
                </button>
                {a.damage.dice.length > 1 && <div className="mt-1 text-xs text-zinc-400">{a.damage.dice.map((d) => `${d.dice} ${d.label}${d.damageType ? ` (${d.damageType})` : ''}`).join(' · ')}</div>}
                {target && !target.dead && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Button variant="success" onClick={() => record(a, 'hit')}>Hit</Button>
                    <Button variant="danger" onClick={() => record(a, 'miss')}>Miss</Button>
                    <Button variant="primary" onClick={() => record(a, 'crit')}>Crit!</Button>
                  </div>
                )}
                {expanded === a.index && (
                  <div className="mt-3 space-y-3 text-sm">
                    <Breakdown title="Attack" entries={a.attackBreakdown} />
                    <Breakdown title="Damage" entries={a.damage.breakdown} />
                    {a.nearMiss.length > 0 && (
                      <div>
                        <div className="mb-1 text-xs uppercase text-zinc-500">Not applying</div>
                        {a.nearMiss.map((n) => <div key={n.source + n.label} className="text-zinc-500"><span className="text-zinc-400">{n.label}</span> ({n.summary}) — needs {n.failed}</div>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {result && result.notes.length > 0 && (
        <div className="mt-3 space-y-1">{result.notes.map((n) => <div key={n} className="rounded-xl bg-zinc-900 px-3 py-2 text-sm text-amber-100">📝 {n}</div>)}</div>
      )}

      {/* actions */}
      {actions.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Abilities & charges</div>
          <div className="space-y-2">
            {actions.map((a) => (
              <div key={a.activationId} data-ability={a.abilityId} data-activation={a.activationId} className={cx('flex items-center justify-between gap-2 rounded-xl border px-3 py-2', a.usable ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 opacity-70', a.active && 'border-emerald-700')}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.name}{a.active ? <span className="ml-2 text-xs text-emerald-300">ACTIVE</span> : null}</div>
                  <div className="truncate text-xs text-zinc-500">{originLabel(a)}</div>
                  <div className="text-xs text-zinc-400">
                    {a.charges && <span className="mr-2">{a.charges.label}: <b className={a.charges.remaining === 0 ? 'text-red-400' : 'text-emerald-300'}>{a.charges.remaining}/{a.charges.max}</b> /{a.charges.resetOn}</span>}
                    <span className="mr-2">{typeof a.action === 'string' ? humanize(a.action) : 'long'} action</span>
                    {!a.charges && !a.costText.length && <span className="mr-2">at will</span>}
                    {a.costText.map((t) => <span key={t} className="mr-2">costs {t}</span>)}
                    {a.declare && <span className="mr-2">declare before roll</span>}
                  </div>
                  {a.reasons.map((r) => <div key={r} className="text-xs text-amber-300">{r}</div>)}
                  {a.notes.map((n) => <div key={n} className="text-xs text-zinc-300">{n}</div>)}
                </div>
                <Button size="sm" variant={a.active ? 'ghost' : 'default'} disabled={!a.usable || a.active} onClick={() => use(a)}>{a.active ? 'Active' : 'Use'}</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {prompt && <PromptSheet ctx={ctx} id={prompt.id} category={prompt.category} onClose={() => setPromptOpen(undefined)} />}
    </div>
  );
}

function ToggleChip({ id, on, onToggle }: { id: string; on: boolean; onToggle: () => void }) {
  const press = usePathLongPress(`battle.toggles.${id}`);
  return <span {...press}><Chip tone="amber" active={on} onClick={onToggle}>{humanize(id)}</Chip></span>;
}

function PromptRow({ request, label, disabled, onOpen }: { request: PromptRequest; label: string; disabled: boolean; onOpen: () => void }) {
  const press = usePathLongPress(`battle.prompts.${request.promptId}`);
  return (
    <button type="button" {...press} disabled={disabled} onClick={onOpen} className="block w-full rounded-xl border border-amber-800 bg-amber-950/40 px-3 py-2 text-left text-sm text-amber-200 disabled:opacity-60">
      🎲 {label} <span className="underline">enter result</span>
    </button>
  );
}

export function Breakdown({ title, entries }: { title: string; entries: BreakdownEntry[] }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase text-zinc-500">{title}</div>
      {entries.map((e, i) => (
        <div key={i} className={cx('flex justify-between', !e.applied && 'text-zinc-600 line-through')}>
          <span>{e.label}{e.source !== 'base' && e.sourceName !== e.label ? <span className="text-zinc-500"> · {e.sourceName}</span> : null}{e.bonusType !== 'untyped' ? <span className="text-zinc-500"> ({e.bonusType})</span> : null}</span>
          <span className="tabular-nums">{signed(e.value)}</span>
        </div>
      ))}
      {entries.filter((e) => !e.applied).map((e, i) => <div key={'r' + i} className="text-xs text-zinc-500">{e.label}: {e.reason}</div>)}
    </div>
  );
}

export function PromptSheet({ ctx, id, category, onClose }: { ctx: EvalContext; id: string; category?: string; onClose: () => void }) {
  const setBattle = useStore((s) => s.setBattle);
  const [value, setValue] = useState('');
  const target = ctx.target;
  const catTag = category && target ? target.tags.find((t) => ctx.library.tags[t]?.category === category) : undefined;
  return (
    <Sheet open onClose={onClose} title={`${humanize(id)} check`}>
      <p className="mb-3 text-sm text-zinc-400">{category ? (catTag ? `Applies to every ${ctx.library.tags[catTag]?.label ?? catTag} this battle.` : `Target needs a ${category} tag first.`) : 'Applies for this battle.'}</p>
      <Field label="Roll result (d20 + skill)" htmlFor="prompt-value"><input id="prompt-value" className={inputCls + ' text-2xl'} inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      <Button variant="primary" size="lg" className="w-full" disabled={!value || (!!category && !catTag)} onClick={() => { setBattle(setPrompt(ctx, { id, ...(category ? { perTagCategory: category } : {}), value: Number(value) })); onClose(); }}>Save</Button>
    </Sheet>
  );
}
