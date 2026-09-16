import { useEffect } from 'react';
import { useStore } from './store/store';
import { BattleScreen } from './screens/BattleScreen';
import { CharacterScreen } from './screens/CharacterScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { cx } from './components/ui';
import { bootSucceeded, setSafeMode } from './boot';

const TABS = [
  { id: 'battle', label: 'Battle', icon: '⚔️' },
  { id: 'character', label: 'Memento', icon: '🏹' },
  { id: 'inventory', label: 'Inventory', icon: '🎒' },
  { id: 'library', label: 'Library', icon: '📚' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
] as const;

export default function App() {
  const hydrated = useStore((s) => s.hydrated);
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const toast = useStore((s) => s.toast);
  const name = useStore((s) => s.character?.name);
  const refreshDiagnostics = useStore((s) => s.refreshDiagnostics);
  const safeMode = useStore((s) => s.safeMode);
  const safeModeAuto = useStore((s) => s.safeModeAuto);
  const setSafeModeState = useStore((s) => s.setSafeModeState);
  useEffect(() => { refreshDiagnostics(); });
  useEffect(() => { if (hydrated) bootSucceeded(); }, [hydrated]);

  if (!hydrated) return <div className="flex h-full items-center justify-center text-zinc-500">Loading…</div>;

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto pb-24">
        {safeMode && (
          <div data-role="safe-banner" className="m-3 rounded-2xl border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            <div>Scripts are off (safe mode).{safeModeAuto ? ' The app failed to start twice, so they were switched off for you.' : ''} Numbers show base values only.</div>
            <button type="button" className="mt-2 rounded-xl bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950" onClick={() => { setSafeMode(false); setSafeModeState(false); }}>Turn scripts back on</button>
          </div>
        )}
        {screen === 'battle' && <BattleScreen />}
        {screen === 'character' && <CharacterScreen />}
        {screen === 'inventory' && <InventoryScreen />}
        {screen === 'library' && <LibraryScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
      {toast && <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-zinc-100 px-4 py-2 text-sm text-zinc-900 shadow-lg">{toast}</div>}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-zinc-800 bg-zinc-950/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setScreen(t.id)} className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-xs select-none touch-manipulation', screen === t.id ? 'text-amber-400' : 'text-zinc-500')}>
            <span className="text-xl leading-none">{t.icon}</span>
            <span>{t.id === 'character' ? name ?? t.label : t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
