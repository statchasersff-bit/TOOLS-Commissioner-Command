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

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] caught:", error.message);
    console.error("[ErrorBoundary] stack:", error.stack);
    console.error("[ErrorBoundary] component trace:", info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", background: "#07111f", color: "#f87171", minHeight: "100vh" }}>
          <h2 style={{ color: "#d4af37", marginBottom: 12 }}>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#fca5a5", background: "#0b1e36", padding: 16, borderRadius: 8, border: "1px solid rgba(248,113,113,0.3)", marginBottom: 12 }}>
            {(error as Error).message}{"\n\n"}{(error as Error).stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ padding: "8px 16px", background: "#0b3a7a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const BASE_PATH = import.meta.env.DEV ? "" : (import.meta.env.BASE_URL.replace(/\/$/, "") || "");

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
