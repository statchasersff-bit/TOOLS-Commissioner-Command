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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AuthGate>
            <SleeperProvider>
              <ValueModelProvider>
                <Toaster />
                <Router />
              </ValueModelProvider>
            </SleeperProvider>
          </AuthGate>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
