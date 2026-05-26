import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getShortPlayerName } from "@/lib/playerNames";

type ResponsivePlayerNameProps = {
  name: string;
  className?: string;
  /** Skip measurement and always render the short form (e.g. compact cards). */
  forceShort?: boolean;
};

/**
 * Renders a player's full name, automatically falling back to the short
 * "C. Lamb" form when the full name would overflow its container — instead of
 * ugly ellipsis truncation. The full name is always preserved in the `title`
 * attribute for hover.
 *
 * Container-based detection (not viewport-only): a hidden measurer holds the
 * full name at its natural width and is compared against the available width
 * via a ResizeObserver, so the name adapts to column/card resizes too.
 *
 * Flicker/loop-safe: the observed element is `block` and fills its parent, so
 * toggling the visible text does NOT change its width (no feedback loop), and
 * the measurement happens in a layout effect + rAF before paint.
 */
export function ResponsivePlayerName({ name, className, forceShort = false }: ResponsivePlayerNameProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [short, setShort] = useState(forceShort);

  useLayoutEffect(() => {
    if (forceShort) {
      setShort(true);
      return;
    }
    const el = ref.current;
    const measure = measureRef.current;
    if (!el || !measure) return;

    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const avail = el.clientWidth;
        const full = measure.scrollWidth;
        // +1 tolerance avoids sub-pixel jitter flipping the state.
        if (avail > 0) setShort(full > avail + 1);
      });
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [name, forceShort]);

  return (
    <span
      ref={ref}
      className={cn("relative block min-w-0 overflow-hidden whitespace-nowrap [text-overflow:clip]", className)}
      title={name}
      data-full-name={name}
    >
      {/* Hidden full-name measurer — out of flow, never wraps, doesn't affect layout. */}
      <span ref={measureRef} aria-hidden className="invisible absolute left-0 top-0 whitespace-nowrap pointer-events-none">
        {name}
      </span>
      {forceShort || short ? getShortPlayerName(name) : name}
    </span>
  );
}
