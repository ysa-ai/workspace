import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-[12px] text-err">{error.message || "Something went wrong"}</p>
          <button
            onClick={this.reset}
            className="text-[11px] text-text-muted hover:text-text-primary underline cursor-pointer transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
