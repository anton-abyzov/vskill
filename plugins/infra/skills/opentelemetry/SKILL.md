---
description: OpenTelemetry expert for Collector pipeline configuration, auto-instrumentation per language, and sampling strategies.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# OpenTelemetry Implementation

## OTel Collector Pipeline Configuration

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

  prometheus:
    config:
      scrape_configs:
        - job_name: 'kubernetes-pods'
          kubernetes_sd_configs:
            - role: pod
          relabel_configs:
            - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
              action: keep
              regex: true

  jaeger:
    protocols:
      thrift_http:
        endpoint: 0.0.0.0:14268

processors:
  batch:
    send_batch_size: 8192
    send_batch_max_size: 16384
    timeout: 5s

  attributes:
    actions:
      - key: environment
        value: production
        action: upsert
      - key: internal.secret
        action: delete

  filter:
    error_mode: ignore
    traces:
      span:
        - 'attributes["http.route"] == "/health"'
        - 'attributes["http.route"] == "/ready"'

  tail_sampling:
    decision_wait: 10s
    num_traces: 100000
    policies:
      - name: errors-always
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: slow-traces
        type: latency
        latency:
          threshold_ms: 1000
      - name: probabilistic
        type: probabilistic
        probabilistic:
          sampling_percentage: 10

  memory_limiter:
    check_interval: 1s
    limit_mib: 2048
    spike_limit_mib: 512

exporters:
  otlp:
    endpoint: tempo.monitoring.svc:4317
    tls:
      insecure: true

  otlp/datadog:
    endpoint: https://api.datadoghq.com
    headers:
      DD-API-KEY: ${env:DD_API_KEY}

  prometheusremotewrite:
    endpoint: http://mimir.monitoring.svc:9009/api/v1/push

  loki:
    endpoint: http://loki.monitoring.svc:3100/loki/api/v1/push

service:
  pipelines:
    traces:
      receivers: [otlp, jaeger]
      processors: [memory_limiter, batch, attributes, filter, tail_sampling]
      exporters: [otlp]

    metrics:
      receivers: [otlp, prometheus]
      processors: [memory_limiter, batch, attributes]
      exporters: [prometheusremotewrite]

    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch, attributes]
      exporters: [loki]

  telemetry:
    logs:
      level: info
    metrics:
      address: 0.0.0.0:8888
```

## Auto-Instrumentation Setup

### Node.js

```typescript
// tracing.ts - import FIRST, before any other module
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'order-service',
    [ATTR_SERVICE_VERSION]: '1.2.0',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV,
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 30000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingPaths: ['/health', '/ready'],
      },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-pg': { enabled: true },
      '@opentelemetry/instrumentation-redis': { enabled: true },
    }),
  ],
});

sdk.start();
process.on('SIGTERM', () => sdk.shutdown());
```

### Python

```bash
# Zero-code auto-instrumentation via CLI
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install
opentelemetry-instrument python app.py
```

```python
# Or programmatic setup:
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

resource = Resource.create({
    "service.name": "order-service",
    "service.version": "1.2.0",
    "deployment.environment": "production",
})

provider = TracerProvider(resource=resource)
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://otel-collector:4317"))
)
trace.set_tracer_provider(provider)

FlaskInstrumentor().instrument()
SQLAlchemyInstrumentor().instrument(engine=db_engine)
```

### Java (Agent)

```bash
curl -Lo opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar

java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.service.name=order-service \
  -Dotel.exporter.otlp.endpoint=http://otel-collector:4317 \
  -Dotel.traces.sampler=parentbased_traceidratio \
  -Dotel.traces.sampler.arg=0.1 \
  -jar app.jar
```

### .NET

```bash
# Zero-code via startup hook
dotnet add package OpenTelemetry.AutoInstrumentation
# Set env vars:
OTEL_DOTNET_AUTO_HOME=/opt/otel-dotnet
OTEL_SERVICE_NAME=order-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
CORECLR_ENABLE_PROFILING=1
CORECLR_PROFILER={918728DD-259F-4A6A-AC2B-B85E1B658318}
CORECLR_PROFILER_PATH=${OTEL_DOTNET_AUTO_HOME}/linux-x64/OpenTelemetry.AutoInstrumentation.Native.so
DOTNET_STARTUP_HOOKS=${OTEL_DOTNET_AUTO_HOME}/net/OpenTelemetry.AutoInstrumentation.StartupHook.dll
```

## Sampling Strategies

| Strategy | Where | Use Case | Config |
|----------|-------|----------|--------|
| **AlwaysOn** | SDK | Dev/debug | `otel.traces.sampler=always_on` |
| **AlwaysOff** | SDK | Disable traces | `otel.traces.sampler=always_off` |
| **TraceIdRatio** | SDK (head) | Uniform sampling | `parentbased_traceidratio` + `arg=0.1` |
| **Tail Sampling** | Collector | Error/latency-based | `tail_sampling` processor |

### Traffic-Based Decision Framework

```
Traffic < 100 RPS     -> AlwaysOn (keep everything)
Traffic 100-1000 RPS  -> Head-based 50% + tail sampling for errors
Traffic 1000-10000 RPS -> Head-based 10% + tail sampling
Traffic > 10000 RPS   -> Head-based 1% + tail sampling for errors/slow
```

### Cardinality Control (Cost Optimization)

```
HIGH CARDINALITY (AVOID as metric attributes):
  - user.id, request.id, session.id
  - full URL paths with IDs (/users/12345)
  - timestamps, UUIDs

LOW CARDINALITY (GOOD for metric attributes):
  - http.method (GET, POST, PUT, DELETE)
  - http.status_code (200, 404, 500)
  - service.name, environment
  - http.route template (/users/{id})
```
