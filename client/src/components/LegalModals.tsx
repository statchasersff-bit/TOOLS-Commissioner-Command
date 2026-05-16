import { X, Cookie, FileText, Shield, Database, Sliders, UserX, Mail, Server, BarChart2, Link2, AlertCircle } from "lucide-react";
import logoDark from "@assets/statchasers_logo_transparent_dark_1772764844282.png";
import logoLight from "@assets/statchasers_logo_transparent_light_1772764844283.png";

const LAST_UPDATED = "May 2025";

// ── Shared modal shell ──────────────────────────────────────────────────────

interface LegalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  testId: string;
  children: React.ReactNode;
}

function LegalShell({ open, onClose, title, subtitle, testId, children }: LegalShellProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col overflow-hidden"
      style={{ background: "rgba(4,8,20,0.97)", backdropFilter: "blur(12px)" }}
    >
      {/* Sticky header */}
      <div
        className="flex-shrink-0 px-4 md:px-8 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(5,10,24,0.90)" }}
      >
        <div className="flex items-center gap-3">
          <img src={logoDark} alt="StatChasers" className="w-7 h-7 hidden dark:block" />
          <img src={logoLight} alt="StatChasers" className="w-7 h-7 block dark:hidden" />
          <div>
            <h2 className="text-[15px] md:text-base font-black text-white leading-tight tracking-tight">{title}</h2>
            <p className="text-[11px] text-white/40 leading-tight mt-0.5 hidden sm:block">{subtitle}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          data-testid={`button-${testId}-close`}
          className="flex items-center justify-center w-8 h-8 rounded-full transition-colors hover:bg-white/10 text-white/40 hover:text-white/80 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {children}
          {/* Last updated */}
          <p className="text-center text-[11px] text-white/20 pt-4 pb-6">
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────────────────

interface SectionProps {
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  title: string;
  children: React.ReactNode;
}

function Section({ icon: Icon, iconColor = "#d4af37", iconBg = "rgba(212,175,55,0.10)", title, children }: SectionProps) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: iconBg, border: `1px solid ${iconColor}30` }}
        >
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
        </div>
        <h3 className="text-[14px] font-bold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="flex-shrink-0 w-1 h-1 rounded-full mt-[7px]" style={{ background: "#d4af37" }} />
          <span className="text-[12px] text-white/55 leading-snug">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function BodyText({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-white/55 leading-relaxed">{children}</p>;
}

// ── Placeholder shell ──────────────────────────────────────────────────────

interface PlaceholderProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  testId: string;
}

function ComingSoonPlaceholder({ open, onClose, title, subtitle, testId }: PlaceholderProps) {
  return (
    <LegalShell open={open} onClose={onClose} title={title} subtitle={subtitle} testId={testId}>
      <div
        className="rounded-2xl p-10 flex flex-col items-center justify-center text-center"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <AlertCircle className="w-8 h-8 mb-4" style={{ color: "#d4af37" }} />
        <p className="text-[14px] font-bold text-white mb-1">{title}</p>
        <p className="text-[12px] text-white/40 max-w-sm">
          This document is being finalized. Check back soon or contact{" "}
          <a href="mailto:support@statchasers.com" className="underline" style={{ color: "#d4af37" }}>
            support@statchasers.com
          </a>{" "}
          for questions.
        </p>
      </div>
    </LegalShell>
  );
}

// ── Cookies Modal ──────────────────────────────────────────────────────────

interface CookiesModalProps {
  open: boolean;
  onClose: () => void;
}

export function CookiesModal({ open, onClose }: CookiesModalProps) {
  return (
    <LegalShell
      open={open}
      onClose={onClose}
      title="Cookies & Tracking"
      subtitle="How Dynasty Command uses cookies, local storage, and Sleeper authentication data."
      testId="cookies"
    >
      {/* Overview */}
      <Section icon={Cookie} title="Overview">
        <BodyText>
          Dynasty Command uses cookies, local storage, and temporary authentication tokens to improve
          functionality, maintain sessions, and support Sleeper integrations. We aim to collect only
          what is necessary to deliver a great experience and nothing more.
        </BodyText>
      </Section>

      {/* Essential Functionality */}
      <Section icon={Sliders} title="Essential Functionality">
        <BodyText>
          Certain cookies and local storage entries are required for Dynasty Command to work properly.
          These include:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Keeping you signed in to your StatChasers account across sessions",
            "Remembering your active league selection and tab state",
            "Saving UI preferences such as dark/light mode, value model, and layout options",
            "Persisting your draft queue state between page loads",
            "Maintaining waiver claim queues and bulk trade pending actions",
            "Caching player data and FantasyCalc values for faster load times (24-hour TTL)",
          ]} />
        </div>
      </Section>

      {/* Sleeper Authentication */}
      <Section
        icon={Shield}
        title="Sleeper Authentication"
        iconColor="#a5b4fc"
        iconBg="rgba(99,102,241,0.10)"
      >
        <BodyText>
          Dynasty Command integrates with Sleeper to enable live roster management, trade actions, and
          lineup submissions. Here is how Sleeper authentication is handled:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Sleeper authentication tokens are used only for actions you explicitly authorize",
            "Tokens are stored locally in your browser — Dynasty Command does not store Sleeper passwords",
            "Authorized actions include: trade offers, lineup changes, waiver claims, DMs, and draft actions",
            "You can disconnect Sleeper at any time from your account settings",
            "Tokens are cleared when you log out or revoke access",
          ]} />
        </div>
      </Section>

      {/* Analytics & Performance */}
      <Section
        icon={BarChart2}
        title="Analytics & Performance"
        iconColor="#34d399"
        iconBg="rgba(52,211,153,0.10)"
      >
        <BodyText>
          Dynasty Command may use lightweight analytics and performance monitoring tools to understand
          how the platform is used, identify errors, and improve stability. This data is aggregated and
          does not include personally identifiable information. We do not sell analytics data to third
          parties.
        </BodyText>
      </Section>

      {/* Third-Party Services */}
      <Section
        icon={Link2}
        title="Third-Party Services"
        iconColor="#fb923c"
        iconBg="rgba(251,146,60,0.10)"
      >
        <BodyText>
          Dynasty Command may interact with the following third-party services, each operating under
          their own privacy and cookie policies:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Sleeper — fantasy sports data, authentication, and roster management",
            "Stripe — payment processing for premium subscriptions (no card data stored by Dynasty Command)",
            "Discord — community integration and support links",
            "Cloudflare — CDN, DDoS protection, and performance optimization",
            "Analytics providers — aggregated usage metrics and error tracking",
          ]} />
        </div>
      </Section>

      {/* User Control */}
      <Section
        icon={UserX}
        title="Your Control"
        iconColor="#f472b6"
        iconBg="rgba(244,114,182,0.10)"
      >
        <BodyText>
          You are in control of your data and browser state at all times.
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Clear cookies and local storage at any time through your browser settings",
            "Disconnect your Sleeper account from Dynasty Command account settings",
            "Revoke browser permissions (notifications, etc.) through your browser",
            "Log out of your StatChasers account to end the active session",
            "Contact us to request deletion of any account data we hold",
          ]} />
        </div>
      </Section>

      {/* Contact */}
      <Section
        icon={Mail}
        title="Contact"
        iconColor="#60a5fa"
        iconBg="rgba(96,165,250,0.10)"
      >
        <BodyText>
          If you have questions or concerns about how Dynasty Command uses cookies or handles your data,
          reach out at{" "}
          <a
            href="mailto:support@statchasers.com"
            className="font-semibold underline underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "#d4af37" }}
          >
            support@statchasers.com
          </a>
          .
        </BodyText>
      </Section>
    </LegalShell>
  );
}

// ── Terms of Service Modal (placeholder) ──────────────────────────────────

interface TermsModalProps { open: boolean; onClose: () => void; }
export function TermsModal({ open, onClose }: TermsModalProps) {
  return (
    <ComingSoonPlaceholder
      open={open}
      onClose={onClose}
      title="Terms of Service"
      subtitle="Usage terms and conditions for Dynasty Command."
      testId="terms"
    />
  );
}

// ── Privacy Policy Modal (placeholder) ────────────────────────────────────

interface PrivacyModalProps { open: boolean; onClose: () => void; }
export function PrivacyModal({ open, onClose }: PrivacyModalProps) {
  return (
    <ComingSoonPlaceholder
      open={open}
      onClose={onClose}
      title="Privacy Policy"
      subtitle="How StatChasers collects, uses, and protects your data."
      testId="privacy"
    />
  );
}
