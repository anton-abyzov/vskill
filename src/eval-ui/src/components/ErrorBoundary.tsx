import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 8 }}>
            An unexpected error occurred in this panel.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn btn-secondary"
            style={{ marginTop: 16, fontSize: 12 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
