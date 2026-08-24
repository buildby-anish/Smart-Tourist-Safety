import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.surakshasetu.app',
  appName: 'Suraksha Setu',
  webDir: 'dist',
  // No `server.url` on purpose: this makes Capacitor bundle the built
  // dist/ folder INTO the native app binary as local files. The app
  // shell (UI, JS, CSS, images) then works with zero network connection.
  // Only actual API calls (fetching tourists, sending SOS, etc.) need
  // connectivity — and the SOS flow already queues those offline via
  // IndexedDB (see src/lib/db.ts) and syncs when back online.
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0f172a',
      showSpinner: false,
    },
  },
};

export default config;
