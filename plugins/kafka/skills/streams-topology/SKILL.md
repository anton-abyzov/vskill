---
description: Kafka Streams topology design -- KStream vs KTable vs GlobalKTable selection, join co-partitioning requirements, windowing patterns, and state store configuration.
---

# Kafka Streams Topology

## KStream vs KTable vs GlobalKTable

| Abstraction | Semantics | Partitioned? | Use When |
|-------------|-----------|-------------|----------|
| **KStream** | Append-only event log; every record is independent | Yes | Clickstreams, transactions, sensor events -- you care about every event |
| **KTable** | Changelog; latest value per key (upsert semantics) | Yes | User profiles, account balances, product catalog -- you care about current state |
| **GlobalKTable** | Full table replicated to ALL instances | No (broadcast) | Small reference data (countries, config) -- needs to be available on every instance without repartitioning |

**Decision framework:**
- Is it a stream of facts/events? -> **KStream**
- Is it a snapshot of current state that updates? -> **KTable**
- Is it reference/lookup data that every instance needs? -> **GlobalKTable**
- Will the table fit in memory on every instance? No -> **KTable** (partitioned)

```java
KStream<Long, Click> clicks = builder.stream("clicks");           // Every click matters
KTable<Long, User> users = builder.table("users");                // Current user state
GlobalKTable<Long, Product> products = builder.globalTable("products"); // Lookup on any instance
```

## Join Semantics and Co-Partitioning

### Co-Partitioning Requirements

| Join Type | Co-Partitioned? | Windowed? | Notes |
|-----------|----------------|-----------|-------|
| KStream-KStream | **Yes** | **Yes** (required) | Both streams must have same partition count and same key |
| KStream-KTable | **Yes** | No | Stream key must match table key; table side is always "current" |
| KTable-KTable | **Yes** | No | Both tables must share partition count and key |
| KStream-GlobalKTable | **No** | No | No co-partitioning needed; custom key extractor maps stream record to table key |

**Co-partitioning means:** Same number of partitions AND same partitioning strategy (key -> partition mapping). If violated, Kafka Streams throws `TopologyException` at startup.

**Fix co-partitioning violations:**
```java
// Repartition stream to match target partition count/key
KStream<Long, Event> repartitioned = events
    .selectKey((key, value) -> value.getUserId())  // Re-key
    .repartition(Repartitioned.with(Serdes.Long(), eventSerde)
        .withNumberOfPartitions(12));              // Match target
```

### Join Code Patterns

```java
// KStream-KStream: correlate events within time window (REQUIRES co-partitioning)
KStream<Long, Combined> joined = streamA.join(
    streamB,
    (a, b) -> new Combined(a, b),
    JoinWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(10)),
    StreamJoined.with(Serdes.Long(), serdeA, serdeB)
);

// KStream-KTable: enrich events with current state (REQUIRES co-partitioning)
KStream<Long, Enriched> enriched = events.leftJoin(
    usersTable,
    (event, user) -> new Enriched(event, user)
);

// KStream-GlobalKTable: lookup reference data (NO co-partitioning needed)
KStream<Long, Enriched> enriched = events.leftJoin(
    countriesGlobalTable,
    (eventKey, event) -> event.getCountryCode(),  // Key extractor for table lookup
    (event, country) -> new Enriched(event, country)
);
```

## Windowing Patterns

### Tumbling Windows (fixed, non-overlapping)

```java
// 5-minute fixed windows: [0:00-0:05), [0:05-0:10), ...
KTable<Windowed<Long>, Long> counts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
    .count(Materialized.as("tumbling-counts"));
```
Use for: periodic aggregates (events per interval, hourly summaries).

### Hopping Windows (fixed, overlapping)

```java
// 10-minute windows, advancing every 2 minutes
// Produces: [0:00-0:10), [0:02-0:12), [0:04-0:14), ...
KTable<Windowed<Long>, Long> counts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeAndGrace(Duration.ofMinutes(10), Duration.ofMinutes(1))
        .advanceBy(Duration.ofMinutes(2)))
    .count(Materialized.as("hopping-counts"));
```
Use for: moving averages, smoothed metrics. Each event appears in multiple windows.

### Sliding Windows (continuous, triggered by events)

```java
// Any 1-minute period around each event
KTable<Windowed<Long>, Long> counts = events
    .groupByKey()
    .windowedBy(SlidingWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(1)))
    .count(Materialized.as("sliding-counts"));
```
Use for: anomaly detection ("more than N events in any 1-minute span"). Windows are created on demand around actual event timestamps, not at fixed intervals.

### Session Windows (event-driven, variable size)

```java
// Sessions end after 30 minutes of inactivity per key
KTable<Windowed<Long>, Long> sessions = events
    .groupByKey()
    .windowedBy(SessionWindows.ofInactivityGapWithNoGrace(Duration.ofMinutes(30)))
    .count(Materialized.as("session-counts"));
```
Use for: user session analysis, activity tracking. Window boundaries are defined by gaps in the event stream.

### Window Comparison

| Type | Boundaries | Overlap | Event Belongs To |
|------|-----------|---------|-----------------|
| Tumbling | Fixed intervals | None | Exactly 1 window |
| Hopping | Fixed intervals, configurable advance | Yes | Multiple windows |
| Sliding | Around each event timestamp | Yes | Multiple windows |
| Session | Defined by inactivity gap | None | Exactly 1 session |

## State Store Configuration

```java
// Persistent state store (RocksDB) -- survives restarts
Materialized.<Long, Long, KeyValueStore<Bytes, byte[]>>as("my-store")
    .withKeySerde(Serdes.Long())
    .withValueSerde(Serdes.Long())
    .withRetention(Duration.ofDays(7))          // How long to keep data
    .withCachingEnabled()                        // Buffer updates (reduce writes)
    .withLoggingEnabled(Map.of(                  // Changelog topic config
        "retention.ms", "604800000",
        "cleanup.policy", "compact"
    ));

// In-memory state store -- faster but lost on restart (rebuilt from changelog)
Materialized.<Long, Long, KeyValueStore<Bytes, byte[]>>as("fast-store")
    .withKeySerde(Serdes.Long())
    .withValueSerde(Serdes.Long())
    .withStoreType(BuiltInDslStoreSuppliers.IN_MEMORY);

// Interactive queries -- expose state store via REST API
ReadOnlyKeyValueStore<Long, Long> store = streams.store(
    StoreQueryParameters.fromNameAndType("my-store", QueryableStoreTypes.keyValueStore())
);
Long value = store.get(key);
```

**Key config properties:**
```java
Properties props = new Properties();
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG,
    StreamsConfig.EXACTLY_ONCE_V2);              // EOS v2 (Kafka 3.0+)
props.put(StreamsConfig.COMMIT_INTERVAL_MS_CONFIG, 100);
props.put(StreamsConfig.STATE_DIR_CONFIG, "/var/kafka-streams/state");
props.put(StreamsConfig.NUM_STREAM_THREADS_CONFIG, 4);
```
