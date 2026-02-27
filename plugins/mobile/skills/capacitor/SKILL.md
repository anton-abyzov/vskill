---
description: Capacitor 6+ plugin development, native bridge implementation (Swift/Kotlin), and live reload configuration. Use for custom Capacitor plugins, native API bridging, or dev workflow setup.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# Capacitor 6+ Plugin Development & Native Bridge

## Capacitor Configuration

```typescript
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.myapp',
  appName: 'My App',
  webDir: 'dist',
  server: {
    androidScheme: 'https',  // Required for cookies, secure context
    iosScheme: 'capacitor',
    hostname: 'app.example.com',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
```

## Custom Plugin Development

### Plugin Structure

```bash
npm init @capacitor/plugin my-custom-plugin
```

```
my-custom-plugin/
├── src/
│   ├── definitions.ts    # TypeScript interface
│   ├── index.ts          # Plugin registration
│   └── web.ts            # Web implementation
├── ios/
│   └── Sources/
│       └── MyCustomPlugin/
│           └── MyCustomPlugin.swift
├── android/
│   └── src/main/java/com/example/
│       └── MyCustomPlugin.java
└── package.json
```

### TypeScript Definition

```typescript
// src/definitions.ts
export interface MyCustomPlugin {
  echo(options: { value: string }): Promise<{ value: string }>;
  getDeviceInfo(): Promise<DeviceInfo>;
  startBackgroundTask(options: { interval: number }): Promise<void>;
  addListener(
    eventName: 'taskCompleted',
    listenerFunc: (event: { result: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export interface DeviceInfo {
  model: string;
  osVersion: string;
  batteryLevel: number;
}
```

### iOS Implementation (Swift) -- Capacitor 6+ API

```swift
import Capacitor

@objc(MyCustomPlugin)
public class MyCustomPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MyCustomPlugin"
    public let jsName = "MyCustomPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "echo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startBackgroundTask", returnType: CAPPluginReturnPromise),
    ]

    @objc func echo(_ call: CAPPluginCall) {
        let value = call.getString("value") ?? ""
        call.resolve(["value": value])
    }

    @objc func getDeviceInfo(_ call: CAPPluginCall) {
        let device = UIDevice.current
        call.resolve([
            "model": device.model,
            "osVersion": device.systemVersion,
            "batteryLevel": device.batteryLevel,
        ])
    }

    @objc func startBackgroundTask(_ call: CAPPluginCall) {
        let interval = call.getInt("interval") ?? 60

        DispatchQueue.global().asyncAfter(deadline: .now() + .seconds(interval)) {
            self.notifyListeners("taskCompleted", data: ["result": "done"])
        }

        call.resolve()
    }
}
```

### Android Implementation (Kotlin) -- Capacitor 6+ API

```kotlin
@CapacitorPlugin(name = "MyCustomPlugin")
class MyCustomPlugin : Plugin() {

    @PluginMethod
    fun echo(call: PluginCall) {
        val value = call.getString("value") ?: ""
        val result = JSObject()
        result.put("value", value)
        call.resolve(result)
    }

    @PluginMethod
    fun getDeviceInfo(call: PluginCall) {
        val result = JSObject()
        result.put("model", Build.MODEL)
        result.put("osVersion", Build.VERSION.RELEASE)
        result.put("batteryLevel", getBatteryLevel())
        call.resolve(result)
    }

    private fun getBatteryLevel(): Float {
        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).toFloat() / 100
    }
}
```

## Live Reload Configuration

```bash
# Start dev server with live reload on device
ionic cap run ios --livereload --external
ionic cap run android --livereload --external
```

```typescript
// Manual live reload in capacitor.config.ts
const config: CapacitorConfig = {
  server: {
    url: 'http://192.168.1.100:5173',  // Your dev server
    cleartext: true,  // Allow HTTP for dev
  },
};
```

```bash
# Build and sync workflow
npm run build && npx cap sync

# Copy web assets only (faster, no native dep update)
npx cap copy
```

## Appflow Live Updates

```typescript
// capacitor.config.ts
plugins: {
  LiveUpdates: {
    appId: 'YOUR_APP_ID',
    channel: 'production',
    autoUpdateMethod: 'background',
    maxVersions: 2,
  },
}
```
