import { Zap, Shield, ArrowLeft, Sparkles, Clock, Check, type LucideIcon } from "lucide-react";
import { SiDiscord } from "react-icons/si";

const DISCORD_INVITE = "https://discord.gg/yerHQKBrre";

interface CommandComingSoonProps {
  name: string;
  icon: LucideIcon;
  releaseDate: string;
  lead: string;
  blurb: string;
  paragraphs: string[];
  features: string[];
  onBack: () => void;
}

function DiscordButton({ label }: { label: string }) {
  return (
    <a
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="link-coming-soon-discord"
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
      style={{ background: "#5865F2", boxShadow: "0 4px 18px rgba(88,101,242,0.30)" }}
    >
      <SiDiscord className="w-4 h-4" /> {label}
    </a>
  );
}

function CommandComingSoon({ name, icon: Icon, releaseDate, lead, blurb, paragraphs, features, onBack }: CommandComingSoonProps) {
  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[#d4af37]/20 px-6 sm:px-10 py-10 sm:py-14"
        style={{ background: "linear-gradient(160deg, rgba(11,58,122,0.20) 0%, rgba(5,10,24,0.45) 100%)" }}
      >
        <div
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(212,175,55,0.16), transparent 70%)" }}
          aria-hidden
        />

        {/* Command Suite badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 mb-6">
          <Sparkles className="w-3 h-3 text-[#d4af37]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d4af37]">StatChasers Command Suite</span>
        </div>

        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-[#d4af37]/12 border border-[#d4af37]/25">
            <Icon className="w-6 h-6 text-[#d4af37]" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground leading-none">{name}</h1>
            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#d4af37]">
              <Clock className="w-3 h-3" /> Coming {releaseDate}
            </div>
          </div>
        </div>

        <p className="text-lg sm:text-xl font-bold text-foreground mt-6">{lead}</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl leading-relaxed">{blurb}</p>

        <div className="flex flex-wrap items-center gap-2.5 mt-7">
          <DiscordButton label="Join Discord" />
          <button
            onClick={onBack}
            data-testid="button-coming-soon-back"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground border border-border/60 hover:bg-muted/40 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Commissioner Command
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="mt-8 space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm text-muted-foreground leading-relaxed">{p}</p>
        ))}
      </div>

      {/* Planned features */}
      <div className="mt-9">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3">Planned Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {features.map((f) => (
            <div key={f} className="flex items-start gap-2.5 rounded-xl border border-border/50 bg-card/40 px-3.5 py-2.5">
              <Check className="w-4 h-4 text-[#d4af37] flex-shrink-0 mt-0.5" />
              <span className="text-[13px] text-foreground/90">{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Release note */}
      <div className="mt-8 flex items-start gap-2.5 rounded-xl border border-[#d4af37]/20 px-4 py-3" style={{ background: "rgba(212,175,55,0.06)" }}>
        <Clock className="w-4 h-4 text-[#d4af37] flex-shrink-0 mt-0.5" />
        <p className="text-[13px] text-foreground/90 leading-relaxed">
          <span className="font-bold">Expected Release: {releaseDate}.</span>{" "}
          <span className="text-muted-foreground">
            {name} is currently in development and will be part of the expanding StatChasers Command suite.
          </span>
        </p>
      </div>

      {/* CTA */}
      <div
        className="mt-8 rounded-2xl border border-border/60 px-6 py-8 text-center"
        style={{ background: "linear-gradient(160deg, rgba(11,58,122,0.16) 0%, transparent 100%)" }}
      >
        <h3 className="text-lg font-bold text-foreground">Want early access?</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
          Join the StatChasers Discord to follow development updates, beta opportunities, and launch announcements.
        </p>
        <div className="mt-5 flex justify-center">
          <DiscordButton label="Join the Discord" />
        </div>
      </div>
    </div>
  );
}

export function RedraftCommandPage({ onBack }: { onBack: () => void }) {
  return (
    <CommandComingSoon
      name="Redraft Command"
      icon={Zap}
      releaseDate="August 1st, 2026"
      lead="Win your redraft leagues with smarter weekly decisions."
      blurb="Advanced redraft tools for lineup decisions, waivers, trades, and multi-league management."
      paragraphs={[
        "Redraft Command is being built as a complete in-season management tool for fantasy football managers who want more than basic rankings. The goal is to help you make sharper lineup, waiver, trade, and roster decisions using advanced player data, league context, and StatChasers analytics.",
        "Whether you are managing one league or a full portfolio of teams, Redraft Command will help you quickly identify where you have an edge, where your roster is vulnerable, and which moves can improve your weekly win probability.",
      ]}
      features={[
        "Weekly lineup optimization",
        "Waiver wire recommendations",
        "Trade analysis for redraft leagues",
        "Player usage and performance trends",
        "Strength of schedule insights",
        "Buy-low and sell-high indicators",
        "Multi-league roster management",
        "League-specific scoring adjustments",
      ]}
      onBack={onBack}
    />
  );
}

export function CommissionerCommandPage({ onBack }: { onBack: () => void }) {
  return (
    <CommandComingSoon
      name="Commissioner Command"
      icon={Shield}
      releaseDate="August 1st, 2026"
      lead="Run better fantasy leagues with less manual work."
      blurb="A central hub to monitor activity, manage orphans, review trades, and keep your leagues active, fair, and competitive."
      paragraphs={[
        "Commissioner Command is being built for fantasy football commissioners who want cleaner league management, better oversight, and stronger tools for keeping leagues active, fair, and competitive.",
        "The goal is to give commissioners a central hub to monitor league activity, identify inactive managers, review roster and lineup issues, track trades, manage orphans, and improve the overall league experience.",
        "Commissioner Command is designed for both individual commissioners and larger fantasy communities managing multiple leagues.",
      ]}
      features={[
        "Dispersal draft tools",
        "Orphan detection and sharing",
        "Placekicker tracker",
        "Inactive manager detection",
        "Lineup integrity checks",
        "League activity monitoring",
        "Automatic trade tracking and review",
        "Payment and payout tracking",
      ]}
      onBack={onBack}
    />
  );
}
