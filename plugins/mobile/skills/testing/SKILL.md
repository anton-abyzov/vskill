---
description: Maestro YAML-based cross-platform E2E testing and device farm configuration (Firebase Test Lab, AWS Device Farm). Use for Maestro test flows, device farm setup, or mobile CI/CD testing pipelines.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# Mobile Testing -- Maestro & Device Farms

## Maestro E2E Testing

Maestro is a declarative, YAML-based E2E testing framework that works across iOS, Android, React Native, and Flutter.

### Test Flow Examples

```yaml
# .maestro/login_flow.yaml
appId: com.example.myapp
---
- launchApp
- tapOn: "Email"
- inputText: "user@example.com"
- tapOn: "Password"
- inputText: "password123"
- tapOn: "Login"
- assertVisible: "Welcome"
- assertVisible: "Home"
```

```yaml
# .maestro/checkout_flow.yaml
appId: com.example.myapp
---
- launchApp
- tapOn: "Products"
- scrollUntilVisible:
    element: "Premium Widget"
    direction: DOWN
- tapOn: "Premium Widget"
- tapOn: "Add to Cart"
- assertVisible: "Added!"
- tapOn: "Cart"
- assertVisible: "Premium Widget"
- tapOn: "Checkout"
- tapOn: "Confirm Order"
- assertVisible: "Order Confirmed"
```

```yaml
# .maestro/conditional_and_retry.yaml
appId: com.example.myapp
---
- launchApp
- tapOn:
    id: "permission-allow"
    optional: true          # Skip if not present
- tapOn: "Continue"
- retry:
    maxRetries: 3
    commands:
      - tapOn: "Load More"
      - assertVisible: "Item 50"
```

```yaml
# .maestro/input_and_swipe.yaml
appId: com.example.myapp
---
- launchApp
- tapOn:
    id: "search-input"
- inputText: "laptop"
- pressKey: Enter
- assertVisible: "Gaming Laptop"
- swipe:
    direction: LEFT
    duration: 500
- assertVisible: "Next Page"
```

### Running Maestro

```bash
# Run single test
maestro test .maestro/login_flow.yaml

# Run entire suite
maestro test .maestro/

# Interactive recording
maestro studio

# Run on CI (Maestro Cloud)
maestro cloud .maestro/ --apiKey $MAESTRO_API_KEY

# Run with specific device
maestro test --device emulator-5554 .maestro/login_flow.yaml
```

## Device Farms

| Service | Best For | Free Tier |
|---------|----------|-----------|
| Firebase Test Lab | Google ecosystem, Android-first | 5 physical + 10 virtual tests/day |
| AWS Device Farm | AWS users, wide device selection | 250 device-minutes free trial |
| BrowserStack | Large device catalog, parallel runs | No |
| Sauce Labs | Enterprise, comprehensive reporting | No |

### Firebase Test Lab

```bash
# Run instrumentation tests
gcloud firebase test android run \
  --type instrumentation \
  --app app-debug.apk \
  --test app-debug-androidTest.apk \
  --device model=Pixel8,version=35 \
  --device model=Pixel7,version=34

# Run Robo test (automated exploration)
gcloud firebase test android run \
  --type robo \
  --app app-release.apk \
  --device model=Pixel8,version=35 \
  --timeout 300s

# iOS XCTest
gcloud firebase test ios run \
  --test MyAppTests.zip \
  --device model=iphone15pro,version=17.5
```

### AWS Device Farm

```bash
# Schedule a test run
aws devicefarm schedule-run \
  --project-arn $PROJECT_ARN \
  --app-arn $APP_ARN \
  --device-pool-arn $POOL_ARN \
  --test '{"type":"APPIUM_PYTHON","testPackageArn":"'$TEST_ARN'"}'

# Create device pool for specific devices
aws devicefarm create-device-pool \
  --project-arn $PROJECT_ARN \
  --name "Flagship Phones" \
  --rules '[{"attribute":"MODEL","operator":"IN","value":"[\"Pixel 8\",\"Galaxy S24\"]"}]'
```

### GitHub Actions CI Pipeline

```yaml
# .github/workflows/mobile-test.yml
name: Mobile Tests
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm test -- --coverage

  maestro-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: 'temurin', java-version: '17' }
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 35
          script: |
            curl -Ls "https://get.maestro.mobile.dev" | bash
            maestro test .maestro/
```
