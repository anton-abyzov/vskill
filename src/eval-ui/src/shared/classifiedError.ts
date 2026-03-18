export interface ClassifiedError {
  category:
    | "rate_limit"
    | "context_window"
    | "auth"
    | "timeout"
    | "model_not_found"
    | "provider_unavailable"
    | "parse_error"
    | "unknown";
  title: string;
  description: string;
  hint: string;
  retryable: boolean;
  retryAfterMs?: number;
}
