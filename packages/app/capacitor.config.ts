import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.memento.huntersledger',
  appName: "Dungeon Ledger",
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
