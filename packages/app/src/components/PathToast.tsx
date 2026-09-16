import { useEffect, useState } from 'react';
import { describePath } from '@hl/engine';
import { useStore } from '../store/store';

/** What a script would call this number, with a Copy button. Auto-hides after six seconds. */
export function PathToast() {
  const pathToast = useStore((s) => s.pathToast);
  const hidePath = useStore((s) => s.hidePath);
  const skills = useStore((s) => s.library.skills);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!pathToast) return;
    setCopied(false);
    const t = setTimeout(hidePath, 6000);
    return () => clearTimeout(t);
  }, [pathToast, hidePath]);
  if (!pathToast) return null;
  const names = Object.fromEntries(Object.values(skills).map((s) => [s.id, s.name]));
  const copy = async () => {
    try { await navigator.clipboard.writeText(pathToast.path); } catch { /* insecure context */ }
    setCopied(true);
  };
  return (
    <div data-role="path-toast" className="fixed bottom-24 left-1/2 z-50 w-[92%] max-w-md -translate-x-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{pathToast.label ?? describePath(pathToast.path, { skills: names })}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-amber-200">{pathToast.path}</code>
        <button type="button" onClick={copy} className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1 text-sm text-zinc-100">{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={hidePath} aria-label="Dismiss" className="shrink-0 px-2 text-zinc-500">✕</button>
      </div>
    </div>
  );
}
