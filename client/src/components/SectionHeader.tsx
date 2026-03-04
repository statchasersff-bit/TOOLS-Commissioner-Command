import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function SectionHeader({ title, subtitle, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-8", className)}>
      <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight" data-testid={`section-header-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        {title}
      </h2>
      <span className="block h-[3px] w-16 bg-[#d4af37] mt-2.5 rounded-full" />
      {subtitle && (
        <p className="text-sm text-muted-foreground mt-2.5">{subtitle}</p>
      )}
    </div>
  );
}
