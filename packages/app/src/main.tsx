import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './pwa';
import App from './App.tsx';
import { useStore } from './store/store';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { closeTopSheet } from './components/ui';
import { armBootGuard, lastBootError, recordBootErrors } from './boot';

recordBootErrors();
const boot = armBootGuard();
useStore.setState({ safeMode: boot.safeMode, safeModeAuto: boot.autoTripped, bootError: boot.safeMode ? lastBootError() : undefined });
void useStore.getState().hydrate();

if (Capacitor.isNativePlatform()) {
  void CapApp.addListener('backButton', () => {
    if (!closeTopSheet()) void CapApp.minimizeApp();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
