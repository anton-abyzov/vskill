---
description: k6 load test scenario templates (stress, soak, spike) and Lighthouse CI performance budget configuration.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# Performance Testing

## k6 Load Test Scenario Templates

### Stress Test (Find Breaking Point)

```javascript
export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '5m', target: 200 },
        { duration: '2m', target: 300 },
        { duration: '5m', target: 300 },
        { duration: '5m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<1500'],
    http_req_failed: ['rate<0.05'],
  },
};
```

### Soak Test (Extended Duration -- Find Memory Leaks)

```javascript
export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 50,
      duration: '4h',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};
```

### Spike Test (Sudden Burst)

```javascript
export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },   // warm up
        { duration: '10s', target: 500 },  // spike
        { duration: '1m', target: 500 },   // hold spike
        { duration: '10s', target: 10 },   // drop
        { duration: '2m', target: 10 },    // recovery
        { duration: '30s', target: 0 },    // ramp down
      ],
    },
  },
};
```

### Constant Request Rate (SLA Validation)

```javascript
export const options = {
  scenarios: {
    constant_rate: {
      executor: 'constant-arrival-rate',
      rate: 100,             // 100 requests per timeUnit
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
};
```

### Mixed Workload (Multiple Scenarios)

```javascript
export const options = {
  scenarios: {
    browse: {
      executor: 'constant-vus', vus: 30, duration: '10m',
      exec: 'browseProducts',
    },
    checkout: {
      executor: 'ramping-arrival-rate', startRate: 5, timeUnit: '1s',
      stages: [{ duration: '5m', target: 20 }, { duration: '5m', target: 20 }],
      preAllocatedVUs: 50, exec: 'checkout',
    },
  },
  thresholds: {
    'http_req_duration{scenario:browse}': ['p(95)<300'],
    'http_req_duration{scenario:checkout}': ['p(95)<1000'],
  },
};
```

### k6 Run Commands

```bash
k6 run script.js                                          # basic
k6 run -e BASE_URL=https://staging.example.com script.js  # env vars
k6 run --vus 100 --duration 5m script.js                  # override
k6 run --out json=results.json script.js                   # JSON output
k6 run --out influxdb=http://localhost:8086/k6 script.js   # Grafana dashboard
```

## Lighthouse CI Performance Budgets

### lighthouserc.js Configuration

```javascript
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/products',
        'http://localhost:3000/checkout',
      ],
      startServerCommand: 'npm run start',
      startServerReadyPattern: 'Server started',
      numberOfRuns: 3,
      settings: { preset: 'desktop' },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],

        // Core Web Vitals
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],

        // Bundle and resource budgets
        'resource-summary:script:size': ['error', { maxNumericValue: 300000 }],
        'resource-summary:total:size': ['error', { maxNumericValue: 800000 }],
        'resource-summary:third-party:count': ['warn', { maxNumericValue: 10 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
```

### CI: `npm install -g @lhci/cli && lhci autorun` (reads lighthouserc.js automatically). Set `LHCI_GITHUB_APP_TOKEN` secret for PR status checks.
