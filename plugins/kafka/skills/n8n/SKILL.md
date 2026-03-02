---
description: n8n workflow automation with Kafka integration expert. Covers Kafka trigger node, producer node, event-driven workflows, error handling, retries, and no-code/low-code event processing patterns. Activates for n8n kafka, kafka trigger, kafka producer, n8n workflows, event-driven automation, no-code kafka, workflow patterns.
---

# n8n Kafka Workflows Skill

Expert knowledge of integrating Apache Kafka with n8n workflow automation platform for no-code/low-code event-driven processing.

## What I Know

### n8n Kafka Nodes

**Kafka Trigger Node** (Event Consumer):
- Triggers workflow on new Kafka messages
- Supports consumer groups
- Auto-commit or manual offset management
- Multiple topic subscription
- Message batching

**Kafka Producer Node** (Event Publisher):
- Sends messages to Kafka topics
- Supports key-based partitioning
- Header support
- Compression (gzip, snappy, lz4)
- Batch sending

**Configuration**: Use environment variables — `{{$env.KAFKA_BROKERS}}`, `{{$env.KAFKA_USER}}`, `{{$env.KAFKA_PASSWORD}}` — never hardcode credentials in workflows.

## When to Use This Skill

Activate me when you need help with:
- n8n Kafka setup ("Configure Kafka trigger in n8n")
- Workflow patterns ("Event-driven automation with n8n")
- Error handling ("Retry failed Kafka messages")
- Integration patterns ("Enrich Kafka events with HTTP API")
- Producer configuration ("Send messages to Kafka from n8n")
- Consumer groups ("Process Kafka events in parallel")

## Common Workflow Patterns

### Pattern 1: Event-Driven Processing

**Use Case**: Process Kafka events with HTTP API enrichment

```
[Kafka Trigger] → [HTTP Request] → [Transform] → [Database]
     ↓
  orders topic
     ↓
  Get customer data
     ↓
  Merge order + customer
     ↓
  Save to PostgreSQL
```

**n8n Workflow**:
1. **Kafka Trigger**:
   - Topic: `orders`
   - Consumer Group: `order-processor`
   - Offset: `latest`

2. **HTTP Request** (Enrich):
   - URL: `https://api.example.com/customers/{{$json.customerId}}`
   - Method: GET
   - Headers: `Authorization: Bearer {{$env.API_TOKEN}}`

3. **Set Node** (Transform):
   ```javascript
   return {
     orderId: $json.order.id,
     customerId: $json.order.customerId,
     customerName: $json.customer.name,
     customerEmail: $json.customer.email,
     total: $json.order.total,
     timestamp: new Date().toISOString()
   };
   ```

4. **PostgreSQL** (Save):
   - Operation: INSERT
   - Table: `enriched_orders`
   - Columns: Mapped from Set node

### Pattern 2: Fan-Out (Publish to Multiple Topics)

**Use Case**: Single event triggers multiple downstream workflows

```
[Kafka Trigger] → [Switch] → [Kafka Producer] (topic: high-value-orders)
     ↓                ↓
  orders topic        └─→ [Kafka Producer] (topic: all-orders)
                           └─→ [Kafka Producer] (topic: analytics)
```

**n8n Workflow**:
1. **Kafka Trigger**: Consume `orders`
2. **Switch Node**: Route by `total` value
   - Route 1: `total > 1000` → `high-value-orders` topic
   - Route 2: Always → `all-orders` topic
   - Route 3: Always → `analytics` topic
3. **Kafka Producer** (x3): Send to respective topics

### Pattern 3: Retry with Dead Letter Queue (DLQ)

**Use Case**: Retry failed messages, send to DLQ after 3 attempts

```
[Kafka Trigger] → [Try/Catch] → [Success] → [Kafka Producer] (topic: processed)
     ↓                ↓
  input topic     [Catch Error]
                       ↓
                  [Increment Retry Count]
                       ↓
                  [If Retry < 3]
                       ↓ Yes
                  [Kafka Producer] (topic: input-retry)
                       ↓ No
                  [Kafka Producer] (topic: dlq)
```

**n8n Workflow**:
1. **Kafka Trigger**: `input` topic
2. **Try Node**: HTTP Request (may fail)
3. **Catch Node** (Error Handler):
   - Get retry count from message headers
   - Increment retry count
   - If retry < 3: Send to `input-retry` topic
   - Else: Send to `dlq` topic

### Pattern 4: Batch Processing with Aggregation

**Use Case**: Aggregate 100 events, send batch to API

```
[Kafka Trigger] → [Aggregate] → [HTTP Request] → [Kafka Producer]
     ↓               ↓
  events topic   Buffer 100 msgs
                     ↓
                Send batch to API
                     ↓
                Publish results
```

**n8n Workflow**:
1. **Kafka Trigger**: Enable batching (100 messages)
2. **Aggregate Node**: Combine into array
3. **HTTP Request**: POST batch
4. **Kafka Producer**: Send results

### Pattern 5: Change Data Capture (CDC) to Kafka

**Use Case**: Stream database changes to Kafka

```
[Cron Trigger] → [PostgreSQL] → [Compare] → [Kafka Producer]
     ↓               ↓              ↓
  Every 1 min    Get new rows   Find diffs
                                    ↓
                              Publish changes
```

**n8n Workflow**:
1. **Cron**: Every 1 minute
2. **PostgreSQL**: SELECT new rows (WHERE updated_at > last_run)
3. **Function Node**: Detect changes (INSERT/UPDATE/DELETE)
4. **Kafka Producer**: Send CDC events

## Best Practices

### 1. Use Consumer Groups for Parallel Processing

✅ **DO**:
```
Workflow Instance 1:
  Consumer Group: order-processor
  Partition: 0, 1, 2

Workflow Instance 2:
  Consumer Group: order-processor
  Partition: 3, 4, 5
```

❌ **DON'T**:
```
// WRONG: No consumer group (all instances get all messages!)
Consumer Group: (empty)
```

### 2. Handle Errors with Try/Catch

✅ **DO**:
```
[Kafka Trigger]
  ↓
[Try] → [HTTP Request] → [Success Handler]
  ↓
[Catch] → [Error Handler] → [Kafka DLQ]
```

❌ **DON'T**:
```
// WRONG: No error handling (workflow crashes on failure!)
[Kafka Trigger] → [HTTP Request] → [Database]
```

### Other Best Practices (brief)
- **Credentials**: Always use `{{$env.VAR}}` — never hardcode brokers, usernames, or passwords
- **Partitioning**: Set a message key (e.g. `{{$json.customerId}}`) to ensure ordering per entity; omitting the key causes random partitioning
- **Consumer lag**: Monitor with Prometheus/Grafana; increase consumer group size or enable batching when lag builds up

## Error Handling Strategies

### Strategy 1: Exponential Backoff Retry

```javascript
// Function Node (Calculate Backoff)
const retryCount = $json.headers?.['retry-count'] || 0;
const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 60000); // Max 60 seconds

return {
  retryCount: retryCount + 1,
  backoffMs,
  nextRetryAt: new Date(Date.now() + backoffMs).toISOString()
};
```

**Workflow**:
1. Try processing
2. On failure: Calculate backoff
3. Wait (using Wait node)
4. Retry (send to retry topic)
5. If max retries reached: Send to DLQ

### Strategy 2: Circuit Breaker

```javascript
// Function Node (Check Failure Rate)
const failures = $json.metrics.failures || 0;
const total = $json.metrics.total || 1;
const failureRate = failures / total;

if (failureRate > 0.5) {
  // Circuit open (too many failures)
  return { circuitState: 'OPEN', skipProcessing: true };
}

return { circuitState: 'CLOSED', skipProcessing: false };
```

**Workflow**:
1. Track success/failure metrics
2. Calculate failure rate
3. If >50% failures: Open circuit (stop processing)
4. Wait 30 seconds
5. Try single request (half-open)
6. If success: Close circuit (resume)

### Strategy 3: Idempotent Processing

```javascript
// Function Node (Deduplication)
const messageId = $json.headers?.['message-id'];
const cache = $('Redis').get(messageId);

if (cache) {
  // Already processed, skip
  return { skip: true, reason: 'duplicate' };
}

// Process and cache
await $('Redis').set(messageId, 'processed', { ttl: 3600 });
return { skip: false };
```

**Workflow**:
1. Extract message ID
2. Check Redis cache
3. If exists: Skip processing
4. Process message
5. Store message ID in cache (1 hour TTL)

## Performance Optimization

### Batch Processing

**Enable batching in Kafka Trigger**:
```
Kafka Trigger:
  Batch Size: 100
  Batch Timeout: 5000ms  // Max wait 5 seconds
```

**Process batch**:
```javascript
// Function Node (Batch Transform)
const events = $input.all();
const transformed = events.map(event => ({
  id: event.json.id,
  timestamp: event.json.timestamp,
  processed: true
}));

return transformed;
```

**Kafka Producer compression**:
```
Compression: lz4  // Or gzip, snappy
Batch Size: 1000  // Larger batches = better compression
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Consumer lag building | Processing slower than arrival | Increase consumer group size, enable batching, use Split in Batches |
| Duplicate messages | At-least-once delivery | Add idempotency check (Strategy 3 above) |
| Workflow timeout | Long-running HTTP requests | Use async webhook callback pattern |

## Testing

1. **Test with Sample Data**: Right-click node → "Add Sample Data" → Execute workflow → Check outputs
2. **Manual Kafka test**: Produce a test message to the trigger topic and observe workflow execution in n8n UI

## References

- n8n Kafka Trigger: https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.kafkatrigger/
- n8n Kafka Producer: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.kafka/
- n8n Best Practices: https://docs.n8n.io/hosting/scaling/best-practices/
- Workflow Examples: https://n8n.io/workflows

---

**Invoke me when you need n8n Kafka integration, workflow automation, or event-driven no-code patterns!**
