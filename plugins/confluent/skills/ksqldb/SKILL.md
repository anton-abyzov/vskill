---
description: "STREAM vs TABLE semantics, windowed aggregation syntax (tumbling/hopping/session), pull vs push queries, join types, and partitioning requirements."
---

# ksqlDB

## STREAM vs TABLE

| | STREAM | TABLE |
|---|---|---|
| Semantics | Unbounded, append-only events | Mutable, latest state per key |
| Updates | Every row is a new event | Updates override previous value (by key) |
| Backed by | Regular Kafka topic | Compacted Kafka topic |
| Examples | Click events, sensor readings, transactions | User profiles, product inventory, account balances |

```sql
-- STREAM: Every INSERT creates a NEW row
INSERT INTO clicks_stream (user_id, page, timestamp)
VALUES (1, 'homepage', CURRENT_TIMESTAMP());

-- TABLE: INSERT with same key UPDATES existing row
INSERT INTO users_table (user_id, name, email)
VALUES (1, 'John', 'john@example.com');
```

## Pull Queries vs Push Queries

```sql
-- PUSH query: continuous, real-time stream of changes
SELECT user_id, page FROM clicks_stream
WHERE page = 'checkout'
EMIT CHANGES;  -- <-- makes it a push query

-- PULL query: point-in-time lookup (like traditional SQL)
SELECT * FROM users_table WHERE user_id = 123;
-- No EMIT CHANGES = returns once
```

## Windowed Aggregations

### Tumbling Window (Non-Overlapping, Fixed)

```sql
-- Count events every 5 minutes, no overlap
SELECT
  user_id,
  WINDOWSTART AS window_start,
  WINDOWEND AS window_end,
  COUNT(*) AS click_count
FROM clicks_stream
WINDOW TUMBLING (SIZE 5 MINUTES)
GROUP BY user_id
EMIT CHANGES;
-- Windows: [0:00-0:05), [0:05-0:10), [0:10-0:15)
```

### Hopping Window (Overlapping)

```sql
-- 10-minute windows, advancing every 5 minutes
SELECT
  user_id,
  COUNT(*) AS event_count
FROM events
WINDOW HOPPING (SIZE 10 MINUTES, ADVANCE BY 5 MINUTES)
GROUP BY user_id
EMIT CHANGES;
-- Windows: [0:00-0:10), [0:05-0:15), [0:10-0:20)
```

### Session Window (Gap-Based)

```sql
-- Session ends after 30 minutes of inactivity
SELECT
  user_id,
  COUNT(*) AS session_events
FROM events
WINDOW SESSION (30 MINUTES)
GROUP BY user_id
EMIT CHANGES;
```

### Late-Arriving Events

```sql
SELECT COUNT(*) FROM events
WINDOW TUMBLING (SIZE 5 MINUTES, GRACE PERIOD 1 MINUTE)
GROUP BY user_id
EMIT CHANGES;
-- Accepts events up to 1 minute late
```

## Join Types

### Stream-Table Join (Enrich Events)

```sql
CREATE STREAM enriched_clicks AS
SELECT
  c.user_id, c.page, c.timestamp,
  u.name, u.email
FROM clicks_stream c
LEFT JOIN users u ON c.user_id = u.user_id
EMIT CHANGES;
```

### Stream-Stream Join (Correlate Events Within Window)

```sql
CREATE STREAM page_view_with_clicks AS
SELECT
  v.user_id,
  v.page AS viewed_page,
  c.page AS clicked_page
FROM page_views v
INNER JOIN clicks c WITHIN 10 MINUTES
ON v.user_id = c.user_id
EMIT CHANGES;
```

### Table-Table Join

```sql
CREATE TABLE user_with_cart AS
SELECT u.user_id, u.name, c.cart_total
FROM users u
LEFT JOIN shopping_carts c ON u.user_id = c.user_id
EMIT CHANGES;
```

## Partition Alignment (Required for Joins)

Joined streams/tables MUST have the same partition key (co-partitioned).

```sql
-- If not co-partitioned, repartition first:
CREATE STREAM clicks_by_user AS
SELECT * FROM clicks PARTITION BY user_id;

-- Now join works efficiently
SELECT * FROM clicks_by_user c
JOIN users u ON c.user_id = u.user_id;
```

## Materialized Views

```sql
-- Pre-compute expensive aggregations
CREATE TABLE user_order_counts AS
SELECT user_id, COUNT(*) AS order_count
FROM orders GROUP BY user_id
EMIT CHANGES;

-- Pull query is now instant
SELECT order_count FROM user_order_counts WHERE user_id = 123;
```

## Key Pitfalls

**Always window aggregations** -- non-windowed aggregations cause unbounded memory:
```sql
-- BAD: unbounded memory
SELECT COUNT(*) FROM events GROUP BY user_id;

-- GOOD: bounded
SELECT COUNT(*) FROM events
WINDOW TUMBLING (SIZE 1 HOUR) GROUP BY user_id;
```

**Always specify PRIMARY KEY on tables** -- required for joins:
```sql
CREATE TABLE users (
  user_id BIGINT PRIMARY KEY,
  name VARCHAR
) WITH (kafka_topic='users', value_format='AVRO');
```

**Use DECIMAL for currency** -- never DOUBLE:
```sql
total DECIMAL(10, 2)  -- precise
-- NOT: total DOUBLE   -- precision loss
```

**Filter before join** -- reduces processing volume:
```sql
-- GOOD
CREATE STREAM purchases AS SELECT * FROM events WHERE event_type = 'purchase';
SELECT * FROM purchases p JOIN users u ON p.user_id = u.user_id;

-- BAD: joins all events, then filters
SELECT * FROM events e JOIN users u ON e.user_id = u.user_id
WHERE e.event_type = 'purchase';
```
