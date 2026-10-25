import { AlertCircle } from "lucide-react";
import { Panel } from "@dispersal/components/ui";

export default function NotFound() {
  return (
    <div className="w-full flex items-center justify-center py-16">
      <Panel className="w-full max-w-md mx-4 p-6">
        <div className="flex items-center mb-3 gap-2">
          <AlertCircle className="h-7 w-7 text-red-600 dark-any:text-red-400 shrink-0" />
          <h1 className="text-xl font-bold text-foreground">Draft room not found</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          This dispersal draft room doesn't exist or the link has expired. Double-check the share code, or head back to start a new room.
        </p>
      </Panel>
    </div>
  );
}
