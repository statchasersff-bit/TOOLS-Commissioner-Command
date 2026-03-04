import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function SectionHeader({ title, subtitle, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      <h2 className="text-xl font-bold text-foreground" data-testid={`section-header-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        {title}
        <span className="block h-0.5 w-12 bg-[#d4af37] mt-2 rounded-full" />
      </h2>
      {subtitle && (
        <p className="text-sm text-muted-foreground mt-2">{subtitle}</p>
      )}
    </div>
  );
}
