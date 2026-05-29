import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Dynasty Command responsive breakpoint system.
 *
 * One source of truth for the widths the whole app adapts at. These mirror the
 * Tailwind breakpoints we use in markup (see tailwind.config.ts: `xs`=480), so
 * JS-driven decisions (useResponsive / ResponsiveTable) and CSS-driven ones
 * (`sm:` / `md:` / `lg:` classes) stay in lockstep.
 */
export const BREAKPOINTS = {
  mobileSm: 360,
  mobile: 480,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  wide: 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

function readWidth(): number {
  if (typeof window === "undefined") return BREAKPOINTS.desktop;
  return window.innerWidth;
}

/**
 * Module-level subscription so every `useResponsive()` consumer shares a single
 * resize listener + rAF-throttled width read, instead of N listeners fighting.
 */
let sharedWidth = readWidth();
const listeners = new Set<(w: number) => void>();
let rafId: number | null = null;
let bound = false;

function notify() {
  rafId = null;
  const w = readWidth();
  if (w === sharedWidth) return;
  sharedWidth = w;
  listeners.forEach((fn) => fn(w));
}

function onResize() {
  if (rafId != null) return;
  rafId = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(notify) : (notify(), null);
}

function ensureBound() {
  if (bound || typeof window === "undefined") return;
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize, { passive: true });
  bound = true;
}

export interface ResponsiveState {
  width: number;
  /** < 360px — very small phones */
  isMobileSm: boolean;
  /** < 768px — any phone (portrait or small landscape) */
  isMobile: boolean;
  /** 768–1023px */
  isTablet: boolean;
  /** 1024–1279px */
  isLaptop: boolean;
  /** >= 1280px */
  isDesktop: boolean;
  /** >= 1536px */
  isWide: boolean;
  /** Coarse bucket name, handy for switch statements. */
  bucket: "mobileSm" | "mobile" | "tablet" | "laptop" | "desktop" | "wide";
  /** True for >= the given breakpoint width. e.g. `up("tablet")`. */
  up: (bp: Breakpoint) => boolean;
  /** True for < the given breakpoint width. e.g. `down("tablet")`. */
  down: (bp: Breakpoint) => boolean;
}

function deriveBucket(width: number): ResponsiveState["bucket"] {
  if (width < BREAKPOINTS.mobileSm) return "mobileSm";
  if (width < BREAKPOINTS.tablet) return "mobile";
  if (width < BREAKPOINTS.laptop) return "tablet";
  if (width < BREAKPOINTS.desktop) return "laptop";
  if (width < BREAKPOINTS.wide) return "desktop";
  return "wide";
}

/**
 * Viewport-level responsive awareness. Prefer `useContainerWidth()` when a
 * component lives inside a narrow card and should respond to its own box rather
 * than the whole window.
 */
export function useResponsive(): ResponsiveState {
  const [width, setWidth] = useState<number>(sharedWidth);

  useEffect(() => {
    ensureBound();
    const fn = (w: number) => setWidth(w);
    listeners.add(fn);
    // Sync immediately in case width changed between render and effect.
    setWidth(readWidth());
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return {
    width,
    isMobileSm: width < BREAKPOINTS.mobileSm,
    isMobile: width < BREAKPOINTS.tablet,
    isTablet: width >= BREAKPOINTS.tablet && width < BREAKPOINTS.laptop,
    isLaptop: width >= BREAKPOINTS.laptop && width < BREAKPOINTS.desktop,
    isDesktop: width >= BREAKPOINTS.desktop,
    isWide: width >= BREAKPOINTS.wide,
    bucket: deriveBucket(width),
    up: (bp) => width >= BREAKPOINTS[bp],
    down: (bp) => width < BREAKPOINTS[bp],
  };
}

/**
 * Container-level width via ResizeObserver. Use this for tables/cards that may
 * be narrow even on a wide screen (e.g. a table inside a 340px sidebar). The
 * returned `width` is the content-box width of the observed element; it starts
 * at 0 until the first measurement, so guard `width === 0` as "unknown".
 *
 *   const { ref, width } = useContainerWidth<HTMLDivElement>();
 *   return <div ref={ref}>{width < 480 ? <Cards/> : <Table/>}</div>;
 */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Seed synchronously so the first paint isn't stuck at 0.
    setWidth(el.getBoundingClientRect().width);
    let raf: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const w = entry.contentRect.width;
        setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
      });
    });
    observer.observe(el);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return { ref, width };
}

/**
 * Wires the `.dc-scroll-x` edge fades for a horizontally-scrollable container.
 * Attach the returned `ref` to the scroll element; this sets
 * `data-at-start` / `data-at-end` so each fade only shows when there's more
 * content to scroll toward on that side. Call `refresh()` after the content
 * width changes (e.g. rows/columns added) since a ResizeObserver only fires on
 * the element's own box, not its scrollWidth.
 *
 *   const { ref } = useScrollEdges<HTMLDivElement>();
 *   return <div ref={ref} className="dc-scroll-x">…</div>;
 */
export function useScrollEdges<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const refresh = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("data-at-start", String(el.scrollLeft <= 1));
    el.setAttribute("data-at-end", String(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1));
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    refresh();
    el.addEventListener("scroll", refresh, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(refresh) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", refresh);
      ro?.disconnect();
    };
  }, [refresh]);

  return { ref, refresh };
}
