import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ValueModelProvider } from "@/contexts/ValueModelContext";
import { SleeperProvider } from "@/contexts/SleeperContext";
import DynastyCommandCenter from "@/pages/DynastyCommandCenter";

function Router() {
  return (
    <Switch>
      <Route path="/" component={DynastyCommandCenter} />
      <Route component={DynastyCommandCenter} />
    </Switch>
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
