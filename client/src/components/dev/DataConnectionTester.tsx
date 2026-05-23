/**
 * Dev-only StatChasers data connection tester.
 *
 * Renders three dropdowns (position / category / year) and a "Load Data"
 * button. On submit it shows:
 *   - the generated GitHub raw URL (canonical) AND the backend proxy URL
 *   - record count (using shape-tolerant extractRecords)
 *   - the first three records (JSON-pretty)
 *   - any error message
 *
 * Render this anywhere behind an `import.meta.env.DEV` guard. It is safe to
 * import in production builds because nothing here calls out to GitHub
 * until the user clicks Load.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  DATA_CATEGORIES,
  DATA_YEARS,
  POSITIONS,
  buildPositionDataUrl,
  buildProxyPositionDataUrl,
  type DataCategory,
  type DataYear,
  type Position,
} from "@/lib/statChasersDataConfig";
import {
  clearStatChasersCache,
  fetchPositionData,
} from "@/lib/statChasersDataLoader";
import { extractRecords } from "@/lib/statChasersDataUtils";

export function DataConnectionTester() {
  const [position, setPosition] = useState<Position>("te");
  const [category, setCategory] = useState<DataCategory>("efficiency");
  const [year, setYear] = useState<DataYear>(2024);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<unknown[]>([]);
  const [lastLoadedUrls, setLastLoadedUrls] = useState<{ raw: string; proxy: string } | null>(null);

  const urls = useMemo(
    () => ({
      raw: buildPositionDataUrl(position, category, year),
      proxy: buildProxyPositionDataUrl(position, category, year),
    }),
    [position, category, year],
  );

  const onLoad = async () => {
    setLoading(true);
    setError(null);
    setRecords([]);
    setLastLoadedUrls(urls);
    try {
      const json = await fetchPositionData(position, category, year);
      setRecords(extractRecords(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const onClearCache = () => {
    clearStatChasersCache();
    setError(null);
    setRecords([]);
    setLastLoadedUrls(null);
  };

  return (
    <Card className="p-5 space-y-4" data-testid="data-connection-tester">
      <div>
        <h3 className="text-base font-bold tracking-tight">StatChasers Data Connection Tester</h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Dev-only utility for verifying the public-data repo is wired up correctly.
          48 valid combinations (4 positions × 4 categories × 3 years).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1 text-xs">
          <span className="block font-semibold text-muted-foreground uppercase tracking-wider">Position</span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as Position)}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            data-testid="dct-position"
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block font-semibold text-muted-foreground uppercase tracking-wider">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DataCategory)}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            data-testid="dct-category"
          >
            {DATA_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block font-semibold text-muted-foreground uppercase tracking-wider">Year</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value) as DataYear)}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            data-testid="dct-year"
          >
            {DATA_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1.5 text-[11px] font-mono">
        <div className="text-muted-foreground">
          <span className="uppercase tracking-wider text-[9.5px] mr-1.5">Proxy</span>
          <span className="text-foreground break-all">{urls.proxy}</span>
        </div>
        <div className="text-muted-foreground">
          <span className="uppercase tracking-wider text-[9.5px] mr-1.5">Raw</span>
          <span className="text-foreground break-all">{urls.raw}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={onLoad}
          disabled={loading}
          size="sm"
          className="gap-1.5"
          data-testid="dct-load"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Load Data
        </Button>
        <Button
          onClick={onClearCache}
          disabled={loading}
          size="sm"
          variant="outline"
          data-testid="dct-clear-cache"
        >
          Clear cache
        </Button>
      </div>

      {error && (
        <div
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500"
          data-testid="dct-error"
        >
          <p className="font-semibold mb-0.5">Load failed</p>
          <p className="break-all">{error}</p>
        </div>
      )}

      {!error && !loading && lastLoadedUrls && (
        <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2.5 space-y-2" data-testid="dct-result">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold">Records:</span>
            <span className="tabular-nums" data-testid="dct-record-count">{records.length}</span>
            {records.length === 0 && (
              <span className="text-muted-foreground italic">No data available.</span>
            )}
          </div>
          {records.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                First 3 records
              </p>
              <pre className="text-[10.5px] font-mono leading-snug bg-background/60 border border-border/30 rounded p-2 overflow-auto max-h-64" data-testid="dct-sample">
                {JSON.stringify(records.slice(0, 3), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
