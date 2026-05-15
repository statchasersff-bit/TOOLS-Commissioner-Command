// All durations in ms. All easings are CSS easing strings.

export const duration = {
  instant: 0,
  fast: 100,      // micro-interactions: button press, badge swap
  normal: 200,    // default: most transitions, accordion, tooltip
  moderate: 300,  // modals opening, tab switches
  slow: 500,      // page-level transitions, large reveals
  crawl: 800,     // skeleton → content, dramatic reveals
} as const;

export const easing = {
  linear: "linear",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",   // default for most UI motion
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)", // subtle overshoot for modals/toasts
  snappy: "cubic-bezier(0.2, 0, 0, 1)",         // fast-start, smooth settle
} as const;

// Pre-composed transition strings for common use cases
export const transition = {
  fast: `all ${duration.fast}ms ${easing.easeOut}`,
  default: `all ${duration.normal}ms ${easing.easeOut}`,
  modal: `opacity ${duration.moderate}ms ${easing.easeOut}, transform ${duration.moderate}ms ${easing.spring}`,
  fade: `opacity ${duration.normal}ms ${easing.easeInOut}`,
  slide: `transform ${duration.moderate}ms ${easing.easeOut}`,
  skeleton: `background-position ${duration.crawl}ms ${easing.linear}`,
} as const;
