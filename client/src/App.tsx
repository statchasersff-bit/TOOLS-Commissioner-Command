import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ValueModelProvider } from "@/contexts/ValueModelContext";
import { SleeperProvider } from "@/contexts/SleeperContext";
import DynastyCommandCenter from "@/pages/DynastyCommandCenter";

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "") || "";

function Router() {
  return (
    <WouterRouter base={BASE_PATH}>
      <Switch>
        <Route path="/" component={DynastyCommandCenter} />
        <Route component={DynastyCommandCenter} />
      </Switch>
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SleeperProvider>
          <ValueModelProvider>
            <Toaster />
            <Router />
          </ValueModelProvider>
        </SleeperProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
