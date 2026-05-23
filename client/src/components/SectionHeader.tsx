import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function SectionHeader({ title, subtitle, className }: SectionHeaderProps) {
  // Light-mode navy heading + gold rule mirrors statchasers.com section
  // titles; dark mode keeps the existing token-driven foreground so the
  // contrast on the dark canvas stays correct.
  return (
    <div className={cn("hidden md:block mb-6", className)}>
      <h2
        className="text-xl md:text-2xl font-bold tracking-tight text-[var(--sc-blue)] dark:text-foreground"
        data-testid={`section-header-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {title}
      </h2>
      <span className="sc-section-rule" />
      {subtitle && (
        <p className="text-sm mt-2 text-[var(--sc-text-muted)] dark:text-muted-foreground">
          {subtitle}
        </p>
      )}
    </div>
  );
}
