import { useState } from 'react';
import { useStore } from '../store/store';
import { storage } from '../storage';
import { Button, Section, inputCls } from '../components/ui';
import { BUILD, checkForUpdate } from '../pwa';

export function SettingsScreen() {
  const s = useStore();
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<string | undefined>();
  const [overwrite, setOverwrite] = useState(false);
  const [update, setUpdate] = useState<string | undefined>();

  const report = (r: ReturnType<typeof s.importText>) => {
    if (r.error) { setResult(`Import failed:\n${r.error}`); return; }
    const rep = r.report!;
    setResult(`Imported: ${rep.added.length} added, ${rep.updated.length} updated, ${rep.unchanged.length} unchanged${rep.conflicts.length ? `\nConflicts (kept existing; tick "overwrite" to replace):\n${rep.conflicts.map((c) => ` • ${c.key}`).join('\n')}` : ''}`);
    s.showToast('Pack imported');
  };

  return (
    <div className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>

      <Section title="Import content pack" defaultOpen>
        <p className="mb-2 text-sm text-zinc-400">A pack is a JSON file with abilities, tags, monsters, skills or a character. Items with the same id from a newer version of the same pack replace the old ones.</p>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Overwrite conflicting items</label>
        <div className="flex gap-2">
          <Button variant="primary" onClick={async () => { const f = await storage().importFile(); if (f) report(s.importText(f.text, { overwrite })); }}>Pick file…</Button>
        </div>
        <textarea className={inputCls + ' mt-3 h-32 font-mono text-xs'} placeholder="…or paste pack JSON here" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <Button className="mt-2" onClick={() => { if (paste.trim()) { report(s.importText(paste, { overwrite })); setPaste(''); } }}>Import pasted JSON</Button>
        {result && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-zinc-900 p-3 text-xs text-zinc-300">{result}</pre>}
      </Section>

      <Section title="Export" defaultOpen>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => storage().exportFile(`hunters-ledger-library-${stamp()}.json`, s.exportLibraryText())}>Export library pack</Button>
          <Button onClick={() => storage().exportFile(`hunters-ledger-backup-${stamp()}.json`, s.exportBackupText())}>Full backup</Button>
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

      <Section title="About" defaultOpen>
        <p className="text-sm text-zinc-400">Build {BUILD}. Storage: {storage().kind === 'android' ? 'Android app storage' : 'browser IndexedDB'}. Battles kept: {s.pastBattles.length}.</p>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={async () => { setUpdate('Checking…'); const r = await checkForUpdate(); setUpdate({ reloading: 'New version found, reloading…', 'up-to-date': 'Already on the latest version.', unsupported: 'Updates are handled by the browser here.', offline: 'Offline: could not check.' }[r]); }}>Check for update</Button>
          {update && <span className="text-xs text-zinc-400">{update}</span>}
        </div>
      </Section>
    </div>
  );
}

function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
