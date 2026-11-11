import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Native Android and iOS only. There is deliberately no `web` block: this release has no
 * website, PWA or browser build.
 *
 * Only EXPO_PUBLIC_* values are compiled into the app, and only client-safe ones belong
 * there (Supabase URL + anon/publishable key, map style URL). See apps/mobile/.env.example.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Gupit Goa',
  slug: 'gupit-goa',
  version: '0.1.0',
  scheme: 'gupitgoa',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  platforms: ['ios', 'android'],
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'app.gupitgoa.mobile',
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      LSApplicationQueriesSchemes: ['whatsapp', 'comgooglemaps'],
    },
  },
  android: {
    package: 'app.gupitgoa.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0E7C7B',
    },
    // Foreground location only. Background location is explicitly blocked.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { backgroundColor: '#F7F2E9', image: './assets/splash-icon.png', imageWidth: 160 },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Gupit Goa uses your location once, when you ask, to show places near you and to confirm you are at a place when you report how busy it is. It is never tracked in the background or stored.',
        // No "Always" permission strings: the app never asks for background location.
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        isAndroidBackgroundLocationEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Reviewers choose listing photos from the library. Guests are never asked.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    'expo-sqlite',
    'expo-secure-store',
    '@maplibre/maplibre-react-native',
  ],
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
