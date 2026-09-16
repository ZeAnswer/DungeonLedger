import { useState } from 'react';
import { packCode, useStore } from '../store/store';
import { storage } from '../storage';
import { Button, Section, Sheet, inputCls } from '../components/ui';
import { BUILD, checkForUpdate } from '../pwa';
import { quarantinedScripts } from '../store/diagnostics';
import { setSafeMode } from '../boot';
import { PackSchema, type MergeReport, type Pack } from '@hl/engine';

export function SettingsScreen() {
  const s = useStore();
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<string | undefined>();
  const [overwrite, setOverwrite] = useState(false);
  const [update, setUpdate] = useState<string | undefined>();
  const [pending, setPending] = useState<{ pack: Pack; overwrite: boolean } | undefined>();

  const report = (r: { report?: MergeReport; error?: string }) => {
    if (r.error) { setResult(`Import failed:\n${r.error}`); return; }
    const rep = r.report!;
    setResult(`Imported: ${rep.added.length} added, ${rep.updated.length} updated, ${rep.unchanged.length} unchanged${rep.conflicts.length ? `\nConflicts (kept existing; tick "overwrite" to replace):\n${rep.conflicts.map((c) => ` • ${c.key}`).join('\n')}` : ''}`);
    s.showToast('Pack imported');
  };

  const offer = (text: string) => {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) { setResult(`Import failed:\n${(e as Error).message}`); return; }
    const parsed = PackSchema.safeParse(raw);
    if (!parsed.success) { setResult(`Import failed:\n${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`); return; }
    const code = packCode(parsed.data);
    if (code.scripts || code.functions) { setPending({ pack: parsed.data, overwrite }); return; }
    report({ report: s.importPack(parsed.data, { overwrite }) });
  };

  return (
    <div className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>

      <Section title="Import content pack" defaultOpen>
        <p className="mb-2 text-sm text-zinc-400">A pack is a JSON file with abilities, tags, monsters, skills or a character. Items with the same id from a newer version of the same pack replace the old ones.</p>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Overwrite conflicting items</label>
        <div className="flex gap-2">
          <Button variant="primary" onClick={async () => { const f = await storage().importFile(); if (f) offer(f.text); }}>Pick file…</Button>
        </div>
        <textarea className={inputCls + ' mt-3 h-32 font-mono text-xs'} placeholder="…or paste pack JSON here" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <Button className="mt-2" onClick={() => { if (paste.trim()) { offer(paste); setPaste(''); } }}>Import pasted JSON</Button>
        {result && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-zinc-900 p-3 text-xs text-zinc-300">{result}</pre>}
      </Section>

      <Section title="Export" defaultOpen>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => storage().exportFile(`dungeon-ledger-library-${stamp()}.json`, s.exportLibraryText())}>Export library pack</Button>
          <Button onClick={() => storage().exportFile(`dungeon-ledger-backup-${stamp()}.json`, s.exportBackupText())}>Full backup</Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Library pack = every ability/tag/monster/skill + your character, importable anywhere. Full backup also includes the current battle and history.</p>
      </Section>

      <Section title="Restore" defaultOpen>
        <Button variant="danger" onClick={async () => {
          const f = await storage().importFile(); if (!f) return;
          if (!confirm('Replace everything with this backup?')) return;
          const err = s.restoreBackupText(f.text); setResult(err ? `Restore failed: ${err}` : 'Backup restored'); if (!err) s.showToast('Backup restored');
        }}>Restore from backup…</Button>
        <Button variant="ghost" className="ml-2" onClick={async () => { if (confirm('Delete all data and reload the built-in packs?')) { await s.resetToDefaults(); s.showToast('Reset done'); } }}>Reset to built-in packs</Button>
        <p className="mt-3 text-xs text-zinc-500">Partial refresh, keeps skills/HP/ledger/history:</p>
        <Button variant="ghost" onClick={() => { if (confirm('Replace your inventory and item rules with the built-in Memento pack? Skills, HP and the level ledger are not touched.')) { const err = s.reimportInventoryFromDefaults(); s.showToast(err ?? 'Inventory replaced'); } }}>Replace inventory from built-in pack</Button>
      </Section>

      <Section title="Scripts" defaultOpen>
        <p className="mb-2 text-sm text-zinc-400">Safe mode turns every record's scripts off. Base values still resolve, so a pack that breaks the screen can be fixed instead of reinstalled. It also survives a reload (<code>?safe=1</code> forces it).</p>
        <div className="flex gap-2">
          <Button variant={s.safeMode ? 'default' : 'primary'} onClick={() => { setSafeMode(false); s.setSafeModeState(false); }}>Run scripts</Button>
          <Button variant={s.safeMode ? 'primary' : 'default'} onClick={() => { setSafeMode(true); s.setSafeModeState(true); }}>Safe mode (scripts off)</Button>
        </div>
        {s.bootError && <div className="mt-3"><div className="text-xs uppercase tracking-wide text-zinc-500">Last failed start threw</div><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-2 text-xs text-red-300">{s.bootError}</pre></div>}
      </Section>

      <Section title="Script errors" defaultOpen={s.scriptErrors.length > 0} count={s.scriptErrors.length}>
        {s.scriptErrors.length === 0 ? <p className="text-sm text-zinc-500">No script has failed this session.</p> : (
          <div className="space-y-1">
            {s.scriptErrors.map((e) => (
              <div key={`${e.recordId}/${e.scriptId}/${e.message}`} className="rounded-xl border border-red-900 bg-red-950/30 px-3 py-2 text-sm">
                <div className="text-red-200">{e.label}<span className="ml-2 text-xs text-zinc-500">{e.recordId} · {e.phase}{e.line !== undefined ? ` · line ${e.line}` : ''}</span></div>
                <div className="text-xs text-red-300">{e.message}</div>
              </div>
            ))}
          </div>
        )}
        {quarantinedScripts(s.library.abilities).map((q) => (
          <div key={q.key} className="mt-1 rounded-xl border border-amber-900 px-3 py-2 text-sm text-amber-200">{q.recordName}: script &ldquo;{q.scriptId}&rdquo; is paused for this session after three failures.</div>
        ))}
        {s.scriptErrors.length > 0 && <Button className="mt-2" onClick={() => { s.clearScriptErrors(); s.showToast('Script errors cleared'); }}>Clear and retry</Button>}
      </Section>

      <Section title="About" defaultOpen>
        <p className="text-sm text-zinc-400">Build {BUILD}. Storage: {storage().kind === 'android' ? 'Android app storage' : 'browser IndexedDB'}. Battles kept: {s.pastBattles.length}.</p>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={async () => { setUpdate('Checking…'); const r = await checkForUpdate(); setUpdate({ reloading: 'New version found, reloading…', 'up-to-date': 'Already on the latest version.', unsupported: 'Updates are handled by the browser here.', offline: 'Offline: could not check.' }[r]); }}>Check for update</Button>
          {update && <span className="text-xs text-zinc-400">{update}</span>}
        </div>
      </Section>

      <Sheet open={!!pending} onClose={() => setPending(undefined)} title="This pack runs as code">
        {pending && (() => { const code = packCode(pending.pack); return (
          <div data-role="code-confirm">
            <p className="mb-3 text-sm text-zinc-300"><b>{pending.pack.name}</b> carries {code.scripts} script{code.scripts === 1 ? '' : 's'}{code.functions ? ` and ${code.functions} function${code.functions === 1 ? '' : 's'}` : ''}. Scripts are JavaScript that <b>runs as code</b> on this device with the same trust as the built-in packs. Import it only from a source you trust.</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => { report({ report: s.importPack(pending.pack, { overwrite: pending.overwrite }) }); setPending(undefined); }}>Import anyway</Button>
              <Button variant="ghost" onClick={() => setPending(undefined)}>Cancel</Button>
            </div>
          </div>
        ); })()}
      </Sheet>
    </div>
  );
}

function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
