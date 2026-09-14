import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Back-button support without juggling history entries: a single sentinel entry sits on top of the app's
 * history; a back press pops it, we close the top open sheet (if any) and re-arm the sentinel.
 * Android (Capacitor) calls closeTopSheet() from its backButton listener instead.
 */
const sheetStack: { close: () => void }[] = [];
export function closeTopSheet(): boolean {
  const top = sheetStack.pop();
  if (!top) return false;
  top.close();
  return true;
}
export function openSheetCount() { return sheetStack.length; }
if (typeof window !== 'undefined') {
  history.replaceState({ hl: 'base' }, '');
  history.pushState({ hl: 'trap' }, '');
  window.addEventListener('popstate', () => {
    closeTopSheet();
    history.pushState({ hl: 'trap' }, '');
  });
}

export function cx(...parts: (string | false | undefined | null)[]) { return parts.filter(Boolean).join(' '); }

export function Button({ children, onClick, variant = 'default', size = 'md', className, disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'success'; size?: 'sm' | 'md' | 'lg'; className?: string; disabled?: boolean; type?: 'button' | 'submit';
}) {
  const v = {
    default: 'bg-zinc-800 text-zinc-100 active:bg-zinc-700 border border-zinc-700',
    primary: 'bg-amber-500 text-zinc-950 font-semibold active:bg-amber-400',
    success: 'bg-emerald-600 text-white font-semibold active:bg-emerald-500',
    danger: 'bg-red-700 text-white active:bg-red-600',
    ghost: 'bg-transparent text-zinc-300 active:bg-zinc-800',
  }[variant];
  const s = { sm: 'px-2.5 py-1.5 text-sm rounded-lg', md: 'px-4 py-2.5 text-base rounded-xl', lg: 'px-5 py-3.5 text-lg rounded-2xl' }[size];
  return <button type={type} disabled={disabled} onClick={onClick} className={cx('select-none touch-manipulation disabled:opacity-40', v, s, className)}>{children}</button>;
}

export function Chip({ children, active, onClick, tone = 'neutral', className }: { children: ReactNode; active?: boolean; onClick?: () => void; tone?: 'neutral' | 'amber' | 'red' | 'green' | 'blue'; className?: string }) {
  const tones = {
    neutral: active ? 'bg-zinc-200 text-zinc-900 border-zinc-200' : 'bg-zinc-900 text-zinc-300 border-zinc-700',
    amber: active ? 'bg-amber-500 text-zinc-950 border-amber-500' : 'bg-zinc-900 text-amber-300 border-amber-800',
    red: active ? 'bg-red-600 text-white border-red-600' : 'bg-zinc-900 text-red-300 border-red-900',
    green: active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-zinc-900 text-emerald-300 border-emerald-900',
    blue: active ? 'bg-sky-600 text-white border-sky-600' : 'bg-zinc-900 text-sky-300 border-sky-900',
  }[tone];
  return (
    <button type="button" onClick={onClick} className={cx('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm whitespace-nowrap select-none touch-manipulation', tones, onClick ? 'active:opacity-80' : 'cursor-default', className)}>
      {children}
    </button>
  );
}

export function Sheet({ open, onClose, title, children, tall }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; tall?: boolean }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    const entry = { close: () => onCloseRef.current() };
    sheetStack.push(entry);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = sheetStack.indexOf(entry);
      if (i >= 0) sheetStack.splice(i, 1);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className={cx('w-full max-w-lg rounded-t-3xl bg-zinc-900 border-t border-zinc-700 shadow-xl flex flex-col', tall ? 'h-[92vh]' : 'max-h-[85vh]')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-zinc-800">
          <div className="text-lg font-semibold truncate">{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-full bg-zinc-800 px-4 py-1.5 text-sm text-zinc-100 active:bg-zinc-700">✕ Close</button>
        </div>
        <div className="overflow-y-auto px-4 pb-4 flex-1">{children}</div>
        <div className="border-t border-zinc-800 p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={onClose} className="w-full rounded-xl bg-zinc-800 py-2.5 text-zinc-100 active:bg-zinc-700">Close</button>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  const cap = 'mb-1 block text-xs uppercase tracking-wide text-zinc-400';
  return (
    <div className="mb-3">
      {htmlFor ? <label htmlFor={htmlFor} className={cap}>{label}</label> : <div className={cap}>{label}</div>}
      {children}
    </div>
  );
}

export const inputCls = 'w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base text-zinc-100 outline-none focus:border-amber-500';

export function Section({ title, children, right, id, defaultOpen = false, count }: { title: string; children: ReactNode; right?: ReactNode; id?: string; defaultOpen?: boolean; count?: number | string }) {
  const key = id ? `hl.section.${id}` : undefined;
  const [open, setOpen] = useState<boolean>(() => {
    if (!key) return defaultOpen;
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => { const v = !open; setOpen(v); if (key) { try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ } } };
  return (
    <section className="mb-2 rounded-2xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={toggle} className="flex flex-1 items-center gap-2 text-left">
          <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">{title}</h2>
          {count !== undefined && <span className="rounded-full bg-zinc-800 px-2 text-xs text-zinc-400">{count}</span>}
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-950">
      <button type="button" className="px-3 py-1.5 text-lg active:bg-zinc-800" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="min-w-8 text-center tabular-nums">{value}</span>
      <button type="button" className="px-3 py-1.5 text-lg active:bg-zinc-800" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

export function humanize(id: string) {
  return id.replace(/[-_]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`).replace(/^\w/, (c) => c.toUpperCase());
}

export function signed(n: number) { return n >= 0 ? `+${n}` : `${n}`; }
