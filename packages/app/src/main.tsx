import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './pwa';
import App from './App.tsx';
import { useStore } from './store/store';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { closeTopSheet } from './components/ui';

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
