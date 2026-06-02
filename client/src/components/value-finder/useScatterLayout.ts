import { useEffect, useState } from "react";

/**
 * Responsive sizing for the Value Finder scatter charts.
 *
 * On desktop the plots are intentionally wide-and-short (a fixed aspect ratio).
 * That ratio collapses to ~140px tall on a phone — far too cramped to read a
 * scatterplot. So below the desktop breakpoint we switch to a fixed (taller)
 * height and trim the axis chrome (smaller ticks, fewer gridlines, smaller
 * dots) so the data has room to breathe.
 *
 *   mobile  (<768)      → 320px tall
 *   tablet  (768–1024)  → 400px tall
 *   desktop (≥1024)     → aspect 2.31 (≈400–500px on a wide panel)
 */
export interface ScatterLayout {
  /** Spread onto <ResponsiveContainer>: a fixed height on small screens, the
   *  desktop aspect ratio otherwise. */
  containerSize: { aspect: number } | { height: number };
  isMobile: boolean;
  tickFontSize: number;
  labelFontSize: number;
  /** ZAxis size range — smaller dots on touch screens. */
  pointRange: [number, number];
  /** Fewer x ticks on a narrow axis so labels don't collide. */
  xTickCount: number;
  /** Y-axis gutter width for the value ticks. */
  yAxisWidth: number;
}

const DESKTOP_ASPECT = 2.31;

function readLayout(): ScatterLayout {
  const w = typeof window !== "undefined" ? window.innerWidth : 1280;
  if (w < 768) {
    return {
      containerSize: { height: 320 },
      isMobile: true,
      tickFontSize: 10,
      labelFontSize: 10,
      pointRange: [22, 22],
      xTickCount: 4,
      yAxisWidth: 40,
    };
  }
  if (w < 1024) {
    return {
      containerSize: { height: 400 },
      isMobile: false,
      tickFontSize: 10,
      labelFontSize: 11,
      pointRange: [34, 34],
      xTickCount: 6,
      yAxisWidth: 48,
    };
  }
  return {
    containerSize: { aspect: DESKTOP_ASPECT },
    isMobile: false,
    tickFontSize: 10,
    labelFontSize: 11,
    pointRange: [40, 40],
    xTickCount: 6,
    yAxisWidth: 48,
  };
}

export function useScatterLayout(): ScatterLayout {
  const [layout, setLayout] = useState<ScatterLayout>(readLayout);
  useEffect(() => {
    const onResize = () => setLayout(readLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return layout;
}
