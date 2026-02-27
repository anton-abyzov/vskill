---
description: React Native New Architecture (Fabric, TurboModules, JSI) enablement and state management decision framework (Zustand, TanStack Query, Jotai). Use for New Architecture migration or state management selection.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# React Native -- New Architecture & State Management

## New Architecture (Fabric, TurboModules, JSI)

### Enabling

```typescript
// Expo: app.json / app.config.ts (SDK 52+ default)
{ "expo": { "newArchEnabled": true } }
```

```bash
# Bare RN: iOS
cd ios && RCT_NEW_ARCH_ENABLED=1 pod install && cd ..

# Bare RN: Android -- gradle.properties
newArchEnabled=true
```

### TurboModule Spec

```typescript
// specs/NativeCalculator.ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  add(a: number, b: number): number;       // Synchronous via JSI
  getDeviceModel(): string;
  getBatteryLevel(): Promise<number>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeCalculator');
```

Key advantages over old Native Modules:
- Lazy initialization (loaded only when first accessed)
- Type-safe bridge via codegen
- Synchronous method calls possible via JSI

### JSI Host Object (C++)

```cpp
class DeviceInfoHostObject : public jsi::HostObject {
public:
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    auto propName = name.utf8(rt);
    if (propName == "model") {
      return jsi::String::createFromUtf8(rt, getDeviceModel());
    }
    return jsi::Value::undefined();
  }
};
```

## State Management Decision Framework

| Solution | Use When | Persistence |
|----------|----------|-------------|
| **Zustand** | Client state (UI, auth, preferences) | AsyncStorage via middleware |
| **TanStack Query** | Server state, caching, pagination | Built-in cache |
| **Jotai** | Fine-grained atomic state, derived atoms | AsyncStorage atoms |
| **Legend State** | High-frequency updates, real-time sync | Built-in persistence |

**Rule of thumb**: TanStack Query for server state + Zustand for client state. Avoid Redux unless team already uses it.

### Zustand (Client State)

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthStore {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

### Jotai (Atomic State)

```typescript
import { atom, useAtom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import AsyncStorage from '@react-native-async-storage/async-storage';

const storage = createJSONStorage<string>(() => AsyncStorage);
const themeAtom = atomWithStorage<'light' | 'dark'>('theme', 'light', storage);

const userAtom = atom<User | null>(null);
const isLoggedInAtom = atom((get) => get(userAtom) !== null);
```

## Performance Checklist

- Use FlashList over FlatList for long lists
- Use expo-image instead of Image for caching and blurhash
- Enable Hermes engine (default with New Architecture)
- Memoize with useMemo/React.memo, useCallback for handlers
- Lazy-load heavy screens with React.lazy + Suspense
- Profile with React DevTools Profiler

```typescript
// FlashList
import { FlashList } from '@shopify/flash-list';

<FlashList
  data={items}
  renderItem={({ item }) => <ItemCard item={item} />}
  estimatedItemSize={80}
  keyExtractor={(item) => item.id}
/>
```
