---
description: "Debezium CDC connector configs (PostgreSQL/MySQL), SMT chain patterns, dead letter queue configuration, and connector error handling."
---

# Kafka Connect

## Debezium CDC: PostgreSQL

```json
{
  "name": "debezium-postgres-cdc",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "tasks.max": "1",
    "database.hostname": "localhost",
    "database.port": "5432",
    "database.user": "debezium",
    "database.password": "${file:/secrets/postgres:password}",
    "database.dbname": "mydb",
    "topic.prefix": "pg",
    "schema.include.list": "public",
    "table.include.list": "public.users,public.orders",
    "plugin.name": "pgoutput",
    "slot.name": "debezium_slot",
    "publication.name": "debezium_pub",
    "schema.history.internal.kafka.bootstrap.servers": "localhost:9092",
    "schema.history.internal.kafka.topic": "schema-changes.pg",
    "snapshot.mode": "initial",
    "decimal.handling.mode": "string",
    "heartbeat.interval.ms": "10000"
  }
}
```

Key PostgreSQL settings:
- `plugin.name`: Use `pgoutput` (native, no extension needed) or `decoderbufs`
- `slot.name`: Unique replication slot name per connector
- `publication.name`: PostgreSQL publication for logical replication
- `snapshot.mode`: `initial` (full snapshot first), `never` (only changes), `when_needed`
- `heartbeat.interval.ms`: Prevents WAL retention bloat on low-traffic tables

## Debezium CDC: MySQL

```json
{
  "name": "debezium-mysql-cdc",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "tasks.max": "1",
    "database.hostname": "localhost",
    "database.port": "3306",
    "database.user": "debezium",
    "database.password": "${file:/secrets/mysql:password}",
    "database.server.id": "1",
    "topic.prefix": "mysql",
    "database.include.list": "mydb",
    "table.include.list": "mydb.users,mydb.orders",
    "schema.history.internal.kafka.bootstrap.servers": "localhost:9092",
    "schema.history.internal.kafka.topic": "schema-changes.mysql"
  }
}
```

### Debezium Envelope Format

```json
{
  "before": null,
  "after": {"id": 1, "name": "John", "email": "john@example.com"},
  "source": {
    "connector": "mysql", "db": "mydb", "table": "users",
    "ts_ms": 1620000000000, "file": "mysql-bin.000001", "pos": 12345
  },
  "op": "c",  // c=CREATE, u=UPDATE, d=DELETE, r=READ(snapshot)
  "ts_ms": 1620000000000
}
```

## SMT (Single Message Transform) Chains

### Mask Sensitive Fields

```json
{
  "transforms": "maskPII",
  "transforms.maskPII.type": "org.apache.kafka.connect.transforms.MaskField$Value",
  "transforms.maskPII.fields": "email,phone,ssn"
}
```

### Add Processing Timestamp

```json
{
  "transforms": "addTimestamp",
  "transforms.addTimestamp.type": "org.apache.kafka.connect.transforms.InsertField$Value",
  "transforms.addTimestamp.timestamp.field": "processed_at"
}
```

### Flatten Nested JSON (for JDBC sink)

```json
{
  "transforms": "flatten",
  "transforms.flatten.type": "org.apache.kafka.connect.transforms.Flatten$Value",
  "transforms.flatten.delimiter": "_"
}
```
Result: `{"user": {"profile": {"name": "John"}}}` becomes `{"user_profile_name": "John"}`

### Route by Topic with Predicate

```json
{
  "transforms": "routeHighValue",
  "transforms.routeHighValue.type": "org.apache.kafka.connect.transforms.RegexRouter",
  "transforms.routeHighValue.regex": "(.*)",
  "transforms.routeHighValue.replacement": "$1-priority",
  "transforms.routeHighValue.predicate": "isPriority",
  "predicates": "isPriority",
  "predicates.isPriority.type": "org.apache.kafka.connect.transforms.predicates.TopicNameMatches",
  "predicates.isPriority.pattern": "orders"
}
```

### Chaining Multiple SMTs

```json
{
  "transforms": "maskPII,addTimestamp,flatten",
  "transforms.maskPII.type": "org.apache.kafka.connect.transforms.MaskField$Value",
  "transforms.maskPII.fields": "email,phone",
  "transforms.addTimestamp.type": "org.apache.kafka.connect.transforms.InsertField$Value",
  "transforms.addTimestamp.timestamp.field": "processed_at",
  "transforms.flatten.type": "org.apache.kafka.connect.transforms.Flatten$Value",
  "transforms.flatten.delimiter": "_"
}
```

## Dead Letter Queue Configuration

```json
{
  "errors.tolerance": "all",
  "errors.log.enable": "true",
  "errors.log.include.messages": "true",
  "errors.deadletterqueue.topic.name": "dlq-connector-name",
  "errors.deadletterqueue.topic.replication.factor": "3",
  "errors.deadletterqueue.context.headers.enable": "true"
}
```

Headers added to DLQ messages:
- `__connect.errors.topic` - original topic
- `__connect.errors.partition` - original partition
- `__connect.errors.offset` - original offset
- `__connect.errors.exception.class` - error class
- `__connect.errors.exception.message` - error message

## Converter Configuration (Schema Registry)

```json
{
  "key.converter": "io.confluent.connect.avro.AvroConverter",
  "key.converter.schema.registry.url": "http://schema-registry:8081",
  "value.converter": "io.confluent.connect.avro.AvroConverter",
  "value.converter.schema.registry.url": "http://schema-registry:8081"
}
```

## Connector Idempotency

Always use upsert mode for sink connectors to handle restarts:

```json
{
  "insert.mode": "upsert",
  "pk.mode": "record_value",
  "pk.fields": "id"
}
```

Never use `"insert.mode": "insert"` -- causes duplicates on restart.
