import { registerSW } from 'virtual:pwa-register';

/** Build stamp injected by vite.config.ts: short commit + build time. */
export const BUILD = __BUILD__;

let registration: ServiceWorkerRegistration | undefined;
let refreshReady = false;

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) { registration = reg; },
  onNeedRefresh() { refreshReady = true; },
});

export type UpdateResult = 'reloading' | 'up-to-date' | 'unsupported' | 'offline';

/** Ask the service worker for a newer build; if one is found, activate it and reload. */
export async function checkForUpdate(): Promise<UpdateResult> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!navigator.onLine) return 'offline';
  if (refreshReady) { await updateSW(true); return 'reloading'; }
  const reg = registration ?? (await navigator.serviceWorker.getRegistration());
  if (!reg) return 'unsupported';
  try { await reg.update(); } catch { return 'offline'; }
  const found = await new Promise<boolean>((resolve) => {
    const settle = (v: boolean) => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => settle(!!reg.waiting), 8000);
    if (reg.waiting) return settle(true);
    const installing = reg.installing;
    if (!installing) return settle(false);
    installing.addEventListener('statechange', () => { if (installing.state === 'installed') settle(true); if (installing.state === 'redundant') settle(false); });
  });
  if (!found) return 'up-to-date';
  await updateSW(true);
  return 'reloading';
}
