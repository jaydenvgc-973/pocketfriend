import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";

/**
 * SettingsErrorBoundary
 *
 * Architectural safety net for the root Settings page and every Settings subpage.
 *
 * REGRESSION TRACED:
 * The Settings route and all its subpages (/edit-character-*, /finance, /locations)
 * had NO error boundary. When any dependency — an imported component, a resolver
 * function, or a query-dependent render path — threw during render, React
 * unmounted the entire tree and the user saw a blank screen with no way to
 * recover except reloading the app.
 *
 * This boundary catches render errors and keeps the page shell mounted:
 *   - The page header with back-to-home navigation stays visible.
 *   - A clear error state replaces the page body.
 *   - "Try again" resets the boundary so the page re-renders from scratch.
 *
 * This does NOT replace any page or weaken existing functionality. It wraps the
 * existing page components in the existing routing so that a failed dependency
 * produces a recoverable error state instead of a blank screen.
 *
 * Each route gets its own boundary instance (wrapping the element prop directly),
 * so navigating away from an errored page and back creates a fresh boundary.
 */
export default class SettingsErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[SettingsErrorBoundary] Render error caught:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const title = this.props.pageTitle || "Settings";
      return (
        <div className="min-h-screen bg-background pt-16 pb-20">
          <div className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
            <Link to="/home" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          <div className="max-w-lg mx-auto px-6 py-6">
            <div className="flex flex-col items-center justify-center text-center py-16 space-y-4">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-destructive" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Something went wrong loading this page
                </p>
                <p className="text-xs text-muted-foreground">
                  A dependency failed to load. Your data is safe — try again.
                </p>
              </div>
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try again
              </button>
              <Link
                to="/home"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors pt-2"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}