import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** Catches render errors so one broken widget never blanks the whole app. Logs no user data. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error.name, info.componentStack?.split("\n")[1]?.trim());
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-16 max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-soft">
        <AlertTriangle className="mx-auto size-8 text-warning-600" aria-hidden />
        <h2 className="mt-4 font-display text-xl text-ink-900">Something went wrong on this page</h2>
        <p className="mt-2 text-sm text-ink-500">Your data is safe. Try reloading — if it keeps happening, let your administrator know.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800"
        >
          <RotateCcw className="size-4" aria-hidden /> Reload
        </button>
      </div>
    );
  }
}
