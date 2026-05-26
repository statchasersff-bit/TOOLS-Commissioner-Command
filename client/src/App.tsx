import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ValueModelProvider } from "@/contexts/ValueModelContext";
import { PlayerProfileProvider, PlayerProfileNavigator } from "@/contexts/PlayerProfileContext";
import { ManagerIntelProvider } from "@/contexts/ManagerIntelContext";
import { GlobalManagerIntelDrawer } from "@/components/GlobalManagerIntelDrawer";
import { SleeperProvider } from "@/contexts/SleeperContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { WriteAccessModalProvider } from "@/contexts/WriteAccessModalContext";
import { FeatureDisabledDialogHost } from "@/components/FeatureDisabledDialog";
import { DevModeBanner } from "@/components/DevModeBanner";
import { FavoriteTeamProvider } from "@/contexts/FavoriteTeamContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthGate } from "@/pages/auth/AuthGate";
import DynastyCommandCenter from "@/pages/DynastyCommandCenter";
import { Component, useEffect, type ReactNode, type ErrorInfo } from "react";

class ErrorBoundary extends Component<{ label?: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const tag = this.props.label ? `[ErrorBoundary:${this.props.label}]` : "[ErrorBoundary]";
    console.error(`${tag} caught:`, error.message);
    console.error(`${tag} stack:`, error.stack);
    console.error(`${tag} component trace:`, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (error) {
      const tag = this.props.label ? `Crashed: ${this.props.label}` : "Something went wrong";
      return (
        <div style={{ padding: 32, fontFamily: "monospace", background: "#07111f", color: "#f87171", minHeight: "100vh" }}>
          <h2 style={{ color: "#d4af37", marginBottom: 12 }}>{tag}</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#fca5a5", background: "#0b1e36", padding: 16, borderRadius: 8, border: "1px solid rgba(248,113,113,0.3)", marginBottom: 12 }}>
            {error.message}{"\n\n"}{error.stack}
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
      <PlayerProfileNavigator />
      <Switch>
        {/* Player profiles render inside the Command Center shell so the app
            header / mega-menu stays visible. DCC renders <PlayerPage embedded>
            as its content when given a playerProfileId. */}
        <Route path="/players/:playerId">
          {(params) => <DynastyCommandCenter playerProfileId={params?.playerId} />}
        </Route>
        <Route path="/:tab/:sub" component={DynastyCommandCenter} />
        <Route path="/:tab" component={DynastyCommandCenter} />
        <Route path="/" component={DynastyCommandCenter} />
      </Switch>
    </WouterRouter>
  );
}

// ── Post-login render probe ────────────────────────────────────────────────
// Set in the browser console to progressively bring up the authenticated tree:
//   localStorage.setItem('sc-probe', 'login-ok')   // bare "Login successful" screen
//   localStorage.setItem('sc-probe', 'shell')      // shell, no providers
//   localStorage.setItem('sc-probe', 'sleeper')    // + SleeperProvider
//   localStorage.setItem('sc-probe', 'value')      // + ValueModelProvider
//   localStorage.setItem('sc-probe', 'app')        // full app (default)
//   localStorage.removeItem('sc-probe')            // back to full app
// Then reload the page.
type Probe = "login-ok" | "shell" | "sleeper" | "value" | "app";
function getProbe(): Probe {
  try {
    const v = localStorage.getItem("sc-probe");
    if (v === "login-ok" || v === "shell" || v === "sleeper" || v === "value" || v === "app") return v;
  } catch { /* ignore */ }
  return "app";
}

function ProbeBanner({ probe }: { probe: Probe }) {
  if (probe === "app") return null;
  return (
    <div style={{
      position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)",
      zIndex: 9999, background: "#d4af37", color: "#07111f",
      padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      fontFamily: "monospace", boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    }}>
      sc-probe: {probe} — clear via localStorage.removeItem('sc-probe')
    </div>
  );
}

function LoginSuccessScreen() {
  useEffect(() => { console.log("[app] LoginSuccessScreen mounted — probe=login-ok"); }, []);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07111f", color: "#d4af37", fontFamily: "monospace", fontSize: 18 }}>
      Login successful
    </div>
  );
}

function ShellPlaceholder({ label }: { label: string }) {
  useEffect(() => { console.log(`[app] ShellPlaceholder mounted — ${label}`); }, [label]);
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#07111f", color: "#d4af37", fontFamily: "monospace", gap: 8 }}>
      <div style={{ fontSize: 18 }}>Authenticated shell OK</div>
      <div style={{ fontSize: 12, color: "#9ca3af" }}>{label}</div>
    </div>
  );
}

function AuthenticatedTree({ probe }: { probe: Probe }) {
  useEffect(() => { console.log("[app] rendering authenticated shell — probe:", probe); }, [probe]);

  if (probe === "login-ok") return <LoginSuccessScreen />;
  if (probe === "shell")    return <ShellPlaceholder label="no providers mounted" />;
  if (probe === "sleeper")  return (
    <SleeperProvider>
      <ShellPlaceholder label="SleeperProvider only" />
    </SleeperProvider>
  );
  if (probe === "value")    return (
    <SleeperProvider>
      <ValueModelProvider>
        <ShellPlaceholder label="SleeperProvider + ValueModelProvider" />
      </ValueModelProvider>
    </SleeperProvider>
  );

  return (
    <SleeperProvider>
      <ValueModelProvider>
        <PlayerProfileProvider>
          <ManagerIntelProvider>
            <Toaster />
            <ErrorBoundary label="Router/DynastyCommandCenter">
              <Router />
            </ErrorBoundary>
            <GlobalManagerIntelDrawer />
          </ManagerIntelProvider>
        </PlayerProfileProvider>
      </ValueModelProvider>
    </SleeperProvider>
  );
}

function App() {
  const probe = getProbe();
  return (
    <ErrorBoundary label="root">
      <ProbeBanner probe={probe} />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <WriteAccessModalProvider>
              <FavoriteTeamProvider>
                <ThemeProvider>
                  <DevModeBanner />
                  <FeatureDisabledDialogHost />
                  <AuthGate>
                    <ErrorBoundary label="authenticated-tree">
                      <AuthenticatedTree probe={probe} />
                    </ErrorBoundary>
                  </AuthGate>
                </ThemeProvider>
              </FavoriteTeamProvider>
            </WriteAccessModalProvider>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
