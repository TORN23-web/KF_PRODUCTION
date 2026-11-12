import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kfproduction.app',
  appName: 'KF Production',
  webDir: 'www-shell',
  bundledWebRuntime: false,
  server: {
    url: 'https://torn23-web.github.io/KF_PRODUCTION/',
    cleartext: false,
    allowNavigation: ['torn23-web.github.io'],
    errorPath: 'offline.html'
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
