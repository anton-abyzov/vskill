---
description: Expo SDK 52+ patterns, EAS Build/Submit configuration, New Architecture enablement, and dynamic app.config.ts. Use for EAS pipelines, Expo Modules API, config plugins, or New Architecture migration.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# Expo SDK 52+ & EAS

## app.config.ts (Dynamic Configuration)

```typescript
import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'MyApp',
  slug: 'my-app',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'myapp',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'com.example.myapp',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'Camera access for profile photos',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    package: 'com.example.myapp',
    permissions: ['CAMERA', 'ACCESS_FINE_LOCATION'],
  },
  plugins: [
    'expo-router',
    'expo-notifications',
    ['expo-camera', { cameraPermission: 'Allow camera access' }],
    ['expo-build-properties', {
      ios: { deploymentTarget: '15.0', flipper: false },
      android: { compileSdkVersion: 35, targetSdkVersion: 35, minSdkVersion: 24 },
    }],
  ],
  updates: {
    url: 'https://u.expo.dev/your-project-id',
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },
  runtimeVersion: {
    policy: 'fingerprint', // auto-detection of native changes
  },
});
```

## New Architecture (Fabric + TurboModules)

### Enabling (SDK 52+ -- default enabled)

```json
{ "expo": { "newArchEnabled": true } }
```

### TurboModule Spec

```typescript
// specs/NativeDeviceInfo.ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  getDeviceModel(): string;
  getBatteryLevel(): Promise<number>;
  getStorageInfo(): Promise<{ total: number; free: number }>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeDeviceInfo');
```

### Expo Modules API (native without ejecting)

```typescript
// modules/my-module/index.ts
import { NativeModule, requireNativeModule } from 'expo-modules-core';

interface MyModuleEvents {
  onDataReceived: { data: string };
}

declare class MyModuleType extends NativeModule<MyModuleEvents> {
  greet(name: string): string;
  fetchDataAsync(): Promise<string>;
}

export default requireNativeModule<MyModuleType>('MyModule');
```

```swift
// modules/my-module/ios/MyModule.swift
import ExpoModulesCore

public class MyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MyModule")

    Function("greet") { (name: String) -> String in
      return "Hello, \(name)!"
    }

    AsyncFunction("fetchDataAsync") { (promise: Promise) in
      DispatchQueue.global().async {
        let result = performExpensiveWork()
        promise.resolve(result)
      }
    }

    Events("onDataReceived")
  }
}
```

## Config Plugins

Modify native project files without ejecting from the managed workflow.

```typescript
// plugins/withCustomSplash.ts
import { ConfigPlugin, withAndroidStyles } from 'expo/config-plugins';

const withCustomSplash: ConfigPlugin = (config) => {
  return withAndroidStyles(config, (modConfig) => {
    const styles = modConfig.modResults;
    // Modify Android styles.xml
    return modConfig;
  });
};

export default withCustomSplash;
```

## EAS Build & Submit

### eas.json

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "resourceClass": "m-medium" }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your@email.com",
        "ascAppId": "1234567890",
        "appleTeamId": "TEAM_ID"
      },
      "android": {
        "serviceAccountKeyPath": "./google-services-key.json",
        "track": "production"
      }
    }
  }
}
```

### Build & Submit Commands

```bash
# Development build (includes dev client)
eas build --profile development --platform ios

# Production build
eas build --profile production --platform all

# Submit to stores
eas submit --platform ios --latest

# Build and submit in one step
eas build --profile production --platform ios --auto-submit

# Set secrets
eas secret:create --name SENTRY_DSN --value "https://..." --scope project
```

## Monorepo Metro Configuration

Metro does NOT resolve workspace packages by default. Critical config:

```javascript
// apps/mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const monorepoRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

// Watch the entire monorepo
config.watchFolders = [monorepoRoot];

// Resolve node_modules from both app and root
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Prevent duplicate React instances
config.resolver.extraNodeModules = {
  'react': path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
};

// Enable symlink resolution (workspace packages)
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
```

### Monorepo Troubleshooting

| Error | Fix |
|-------|-----|
| `Unable to resolve module @myapp/shared` | Add `watchFolders: [monorepoRoot]` |
| `Unable to resolve module react` (duplicate) | Set `extraNodeModules.react` to app's copy |
| TS resolves but runtime crashes | Configure Metro resolver (tsconfig paths != Metro) |
| `ENOENT` on workspace packages | Set `resolver.unstable_enableSymlinks: true` |

## OTA Updates

```bash
# Publish OTA update
eas update --branch production --message "Fix checkout bug"

# Channel mapping
eas channel:edit production --branch production
```

```typescript
// Manual update check
import * as Updates from 'expo-updates';

async function checkForUpdates() {
  if (__DEV__) return;
  const update = await Updates.checkForUpdateAsync();
  if (update.isAvailable) {
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  }
}
```

## Bundle Size Analysis

```bash
EXPO_ATLAS=1 npx expo export --platform ios
npx expo-atlas path/to/atlas-file
```
