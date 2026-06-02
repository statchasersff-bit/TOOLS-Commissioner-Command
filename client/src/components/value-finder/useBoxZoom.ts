import { useCallback, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

// Drag-to-zoom for Recharts scatter charts (desktop only). The user presses the
// mouse on the plot, drags a box around the points of interest, and releases —
// the chart's x/y domains snap to that box. A reset returns to the default view.
//
// Recharts hands every chart mouse event a state object carrying the data-space
// `xValue` / `yValue` under the cursor, so we can capture the selection directly
// in data coordinates (no pixel→value math needed).

type ChartMouseState = { xValue?: number; yValue?: number } | null | undefined;

export interface DragRect {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface BoxZoom {
  /** True when zoom is active for this device (desktop). */
  enabled: boolean;
  /** Spread onto the ScatterChart. No-ops when disabled. */
  zoomProps: {
    onMouseDown?: (state: ChartMouseState) => void;
    onMouseMove?: (state: ChartMouseState) => void;
    onMouseUp?: () => void;
    onMouseLeave?: () => void;
  };
  /** Active zoom domains, or undefined to use the chart's default domain. */
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** In-progress drag rectangle (data coords) to render as a ReferenceArea. */
  dragRect: DragRect | null;
  /** True once a zoom box has been applied. */
  isZoomed: boolean;
  /** Clear the zoom and return to the default view. */
  reset: () => void;
}

export function useBoxZoom(): BoxZoom {
  const enabled = !useIsMobile();

  const [drag, setDrag] = useState<DragRect | null>(null);
  const [zoom, setZoom] = useState<{ x: [number, number]; y: [number, number] } | null>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback((state: ChartMouseState) => {
    if (state?.xValue == null || state?.yValue == null) return;
    dragging.current = true;
    setDrag({ x1: state.xValue, x2: state.xValue, y1: state.yValue, y2: state.yValue });
  }, []);

  const onMouseMove = useCallback((state: ChartMouseState) => {
    if (!dragging.current || state?.xValue == null || state?.yValue == null) return;
    setDrag((d) => (d ? { ...d, x2: state.xValue!, y2: state.yValue! } : d));
  }, []);

  const finishDrag = useCallback(() => {
    dragging.current = false;
    setDrag((d) => {
      if (d) {
        const xLow = Math.min(d.x1, d.x2);
        const xHigh = Math.max(d.x1, d.x2);
        const yLow = Math.min(d.y1, d.y2);
        const yHigh = Math.max(d.y1, d.y2);
        // Ignore clicks / degenerate boxes — both dimensions must have spread.
        if (xHigh > xLow && yHigh > yLow) {
          setZoom({ x: [xLow, xHigh], y: [yLow, yHigh] });
        }
      }
      return null;
    });
  }, []);

  const reset = useCallback(() => setZoom(null), []);

  if (!enabled) {
    return { enabled: false, zoomProps: {}, dragRect: null, isZoomed: false, reset };
  }

  return {
    enabled: true,
    zoomProps: {
      onMouseDown,
      onMouseMove,
      onMouseUp: finishDrag,
      onMouseLeave: finishDrag,
    },
    xDomain: zoom?.x,
    yDomain: zoom?.y,
    dragRect: drag,
    isZoomed: zoom != null,
    reset,
  };
}
