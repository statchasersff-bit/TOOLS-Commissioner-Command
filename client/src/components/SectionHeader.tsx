import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function SectionHeader({ title, subtitle, className }: SectionHeaderProps) {
  // Light-mode navy heading + gold rule mirrors statchasers.com section
  // titles; dark themes keep the token-driven foreground so the contrast on
  // the dark canvas stays correct. Use `dark-any:` (not `dark:`) so the
  // override also fires in X-mode (.x-mode) — `dark:` only matches `.dark`,
  // which is why X-mode headings were rendering navy instead of white.
  return (
    <div className={cn("hidden md:block mb-6", className)}>
      <h2
        className="text-xl md:text-2xl font-bold tracking-tight text-[var(--sc-blue)] dark-any:text-foreground"
        data-testid={`section-header-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {title}
      </h2>
      <span className="sc-section-rule" />
      {subtitle && (
        <p className="text-sm mt-2 text-[var(--sc-text-muted)] dark-any:text-muted-foreground">
          {subtitle}
        </p>
      )}
    </div>
  );
}
