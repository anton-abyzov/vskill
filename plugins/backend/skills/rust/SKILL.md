---
description: Tower middleware composition for Axum, thiserror custom errors with IntoResponse, and error handling strategy (thiserror vs anyhow).
allowed-tools: Read, Write, Edit, Bash
model: opus
---

# Rust Backend

## Tower Middleware Composition

Layer ordering matters -- layers wrap from **bottom to top** (last added = outermost):

```rust
use axum::{Router, routing::get, middleware};
use tower_http::{cors::CorsLayer, trace::TraceLayer, compression::CompressionLayer};
use tower::ServiceBuilder;

let app = Router::new()
    .route("/api/v1/users", get(list_users).post(create_user))
    .route("/api/v1/users/{id}", get(get_user))
    // Auth only on API routes (applied before global layers)
    .layer(middleware::from_fn_with_state(state.clone(), require_auth))
    // ServiceBuilder applies layers top-to-bottom (first = outermost)
    .layer(
        ServiceBuilder::new()
            .layer(TraceLayer::new_for_http())    // 1st: logs all requests (including rejected)
            .layer(CorsLayer::permissive())        // 2nd: CORS headers before auth check
            .layer(CompressionLayer::new())        // 3rd: compress responses
    )
    .with_state(state);
```

Key rules:
- `TraceLayer` should be outermost to log all requests including auth failures
- `CorsLayer` before auth so preflight OPTIONS requests are not rejected
- Auth middleware on specific route groups, not global, to keep health checks open
- `ServiceBuilder` applies layers in declared order (top = outermost), opposite of `.layer()` chaining

## thiserror Custom Errors with IntoResponse

```rust
use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("resource not found: {0}")]
    NotFound(String),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".into()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Database(e) => {
                tracing::error!("Database error: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".into())
            }
            AppError::Internal(e) => {
                tracing::error!("Internal error: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".into())
            }
        };

        (status, Json(json!({ "error": { "status": status.as_u16(), "message": message } }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

Usage in handlers -- `?` auto-converts via `#[from]`:
```rust
pub async fn get_by_id(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<UserResponse>> {
    let user = sqlx::query_as!(UserRow, "SELECT * FROM users WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?  // sqlx::Error -> AppError::Database via #[from]
        .ok_or_else(|| AppError::NotFound(format!("user {id} not found")))?;
    Ok(Json(user.into()))
}
```

## Error Handling Strategy: thiserror vs anyhow

| Use case | Crate | Why |
|---|---|---|
| Library code / domain errors | `thiserror` | Typed variants, callers can match on specific errors |
| Application entry point / glue | `anyhow` | Wraps any error with context, no boilerplate |
| Axum handlers | `thiserror` + `IntoResponse` | Map each variant to HTTP status |
| Internal helper functions | `anyhow::Context` | `.context("failed to parse config")?` adds stack-like messages |

Pattern: define `AppError` with `thiserror` for HTTP-facing errors. Use `#[from] anyhow::Error` as a catch-all variant for internal errors that should map to 500.
