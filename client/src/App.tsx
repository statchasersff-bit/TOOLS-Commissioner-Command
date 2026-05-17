import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ValueModelProvider } from "@/contexts/ValueModelContext";
import { SleeperProvider } from "@/contexts/SleeperContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthGate } from "@/pages/auth/AuthGate";
import DynastyCommandCenter from "@/pages/DynastyCommandCenter";
import { Component, type ReactNode, type ErrorInfo } from "react";

const CRASH_KEY = "sc-last-crash";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; savedCrash: string | null }> {
  state = { error: null, savedCrash: (() => {
    try {
      const raw = localStorage.getItem(CRASH_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.ts || Date.now() - new Date(parsed.ts).getTime() > 60 * 60 * 1000) {
        localStorage.removeItem(CRASH_KEY);
        return null;
      }
      return raw;
    } catch { return null; }
  })() };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    try {
      localStorage.setItem(CRASH_KEY, JSON.stringify({
        msg: error.message,
        stack: error.stack ?? "",
        component: info.componentStack ?? "",
        ts: new Date().toISOString(),
      }));
    } catch { /* ignore */ }
  }
  render() {
    const { error, savedCrash } = this.state;
    const crashToShow = error ?? (savedCrash ? (() => { try { return JSON.parse(savedCrash); } catch { return null; } })() : null);
    if (error || (savedCrash && !error)) {
      const msg = error ? (error as Error).message : (crashToShow?.msg ?? "unknown");
      const stack = error ? (error as Error).stack : (crashToShow?.stack ?? "");
      const component = error ? "" : (crashToShow?.component ?? "");
      const ts = error ? "" : (crashToShow?.ts ?? "");
      return (
        <div style={{ padding: 32, fontFamily: "monospace", background: "#07111f", color: "#f87171", minHeight: "100vh" }}>
          <h2 style={{ color: "#d4af37", marginBottom: 4 }}>Something went wrong</h2>
          {ts && <p style={{ color: "#6b7280", fontSize: 11, marginBottom: 12 }}>Previous crash recorded at {ts}</p>}
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#fca5a5", background: "#0b1e36", padding: 16, borderRadius: 8, border: "1px solid rgba(248,113,113,0.3)", marginBottom: 8 }}>
            {msg}{"\n\n"}{stack}
          </pre>
          {component && (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#9ca3af", background: "#0b1e36", padding: 12, borderRadius: 8, border: "1px solid rgba(156,163,175,0.2)" }}>
              Component trace:{"\n"}{component}
            </pre>
          )}
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button onClick={() => { try { localStorage.removeItem(CRASH_KEY); } catch { /* ignore */ } this.setState({ error: null, savedCrash: null }); }} style={{ padding: "8px 16px", background: "#0b3a7a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              Try again
            </button>
            <button onClick={() => { try { localStorage.removeItem(CRASH_KEY); } catch { /* ignore */ } this.setState({ savedCrash: null }); }} style={{ padding: "8px 16px", background: "transparent", color: "#9ca3af", border: "1px solid rgba(156,163,175,0.3)", borderRadius: 6, cursor: "pointer" }}>
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "") || "";

function Router() {
  return (
    <WouterRouter base={BASE_PATH}>
      <Switch>
        <Route path="/:tab/:sub" component={DynastyCommandCenter} />
        <Route path="/:tab" component={DynastyCommandCenter} />
        <Route path="/" component={DynastyCommandCenter} />
      </Switch>
    </WouterRouter>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <AuthGate>
              <ErrorBoundary>
                <SleeperProvider>
                  <ValueModelProvider>
                    <Toaster />
                    <Router />
                  </ValueModelProvider>
                </SleeperProvider>
              </ErrorBoundary>
            </AuthGate>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
