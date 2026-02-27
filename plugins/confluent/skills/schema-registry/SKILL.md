---
description: "Compatibility mode decision table, schema evolution rules, Avro vs Protobuf vs JSON Schema comparison."
---

# Schema Registry

## Compatibility Mode Decision Table

| Mode | Who Upgrades First | Allowed Changes | Use Case |
|------|-------------------|-----------------|----------|
| **BACKWARD** (default) | Consumers first | Remove fields, add optional fields with defaults | Most common, safe for consumers |
| **FORWARD** | Producers first | Add fields, remove optional fields | Safe for producers |
| **FULL** | Either | Add/remove optional fields only | Both sides upgrade independently |
| **NONE** | Must coordinate | Any change | Development only, never production |
| **BACKWARD_TRANSITIVE** | Consumers first | BACKWARD across ALL versions | Strictest backward |
| **FORWARD_TRANSITIVE** | Producers first | FORWARD across ALL versions | Strictest forward |
| **FULL_TRANSITIVE** | Either | FULL across ALL versions | Strictest overall |

## Schema Evolution Rules

### Safe Changes (BACKWARD compatible)

```avro
// V1
{
  "type": "record", "name": "User",
  "fields": [
    {"name": "id", "type": "long"},
    {"name": "name", "type": "string"}
  ]
}

// V2 - Add optional field with default
{
  "type": "record", "name": "User",
  "fields": [
    {"name": "id", "type": "long"},
    {"name": "name", "type": "string"},
    {"name": "email", "type": ["null", "string"], "default": null}
  ]
}
```

### Evolution Decision Tree

```
Adding field?
  Required? -> Add with default value
  Optional? -> Add with default null

Removing field?
  Required? -> BREAKING (coordinate upgrade)
  Optional? -> BACKWARD compatible

Changing field type?
  Compatible (int->long)? -> Use union type
  Incompatible? -> BREAKING (add new field, deprecate old)

Renaming field?
  -> BREAKING (add new field + deprecate old)
```

### Do's and Don'ts

DO:
- Add optional fields with defaults
- Remove optional fields
- Use union types for flexibility
- Test schema changes in staging first
- Validate compatibility before registering

DON'T:
- Change field types directly
- Remove required fields
- Rename fields (add new + deprecate old instead)
- Use NONE compatibility in production
- Skip compatibility checks

## Avro vs Protobuf vs JSON Schema

| Feature | Avro | Protobuf | JSON Schema |
|---------|------|----------|-------------|
| Encoding | Binary | Binary | Text (JSON) |
| Message Size | ~90% smaller than JSON | ~80% smaller | Baseline |
| Human Readable | No | No | Yes |
| Schema Evolution | Excellent | Good | Fair |
| Language Support | Java, Python, C++ | 20+ languages | Universal |
| Performance | Very Fast | Very Fast | Slower |
| Best For | Data warehousing, ETL | Polyglot, gRPC | REST APIs, debugging |

**Recommendation**: Avro for production (best evolution support), Protobuf for polyglot teams, JSON Schema for development.

## Compatibility Check Before Registering

```bash
# Check compatibility
curl -X POST http://localhost:8081/compatibility/subjects/users-value/versions/latest \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"schema": "{...}"}'

# Register schema
curl -X POST http://localhost:8081/subjects/users-value/versions \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"schema": "{...}"}'
```

Subject naming: `<topic-name>-value` for values, `<topic-name>-key` for keys.
