// Standard modal/dialog class strings.
// All Commissioner Command modals must follow these specs for consistency.

export const modal = {
  // Overlay backdrop
  overlay: "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",

  // Container variants
  container: {
    sm: "w-full max-w-sm",
    md: "w-full max-w-lg",
    lg: "w-full max-w-2xl",
    xl: "w-full max-w-4xl",
    full: "w-full max-w-[95vw] h-[90vh]",
  },

  // Content panel
  content: "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] rounded-lg border border-card-border bg-card shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",

  // Internal layout zones
  header: "flex flex-col gap-1.5 p-6 pb-4",
  body: "p-6 pt-0",
  footer: "flex items-center justify-end gap-3 p-6 pt-4 border-t border-border",

  // Close button
  closeButton: "absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring",

  // Title / description
  title: "text-xl font-semibold leading-tight tracking-tight text-foreground",
  description: "text-sm text-muted-foreground mt-1",
} as const;
