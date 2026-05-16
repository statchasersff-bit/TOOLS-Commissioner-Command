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
      className="fixed inset-x-0 bottom-0 z-[45] flex flex-col overflow-hidden"
      style={{ top: "61px", background: "rgba(4,8,20,0.97)", backdropFilter: "blur(12px)" }}
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

// ── Terms of Service Modal ─────────────────────────────────────────────────

interface TermsModalProps { open: boolean; onClose: () => void; }
export function TermsModal({ open, onClose }: TermsModalProps) {
  return (
    <LegalShell
      open={open}
      onClose={onClose}
      title="Terms of Service"
      subtitle="Please read these terms carefully before using Dynasty Command and related StatChasers tools."
      testId="terms"
    >
      {/* 1. Overview */}
      <Section icon={FileText} title="Overview">
        <BodyText>
          Dynasty Command ("the Service") is a fantasy football management and analytics platform operated
          by StatChasers. By accessing or using the Service in any form, you agree to be bound by these
          Terms of Service. If you do not agree to these terms, do not use the Service.
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "These terms apply to all users of Dynasty Command, including free and paid tier users.",
            "StatChasers reserves the right to update these terms at any time. Continued use constitutes acceptance.",
            "Some features are in active development or beta — behavior may change without notice.",
          ]} />
        </div>
      </Section>

      {/* 2. Sleeper Authentication */}
      <Section icon={Shield} title="Sleeper Authentication & User Responsibility"
        iconColor="#a5b4fc" iconBg="rgba(99,102,241,0.10)">
        <BodyText>
          Dynasty Command integrates with Sleeper to enable live roster management and league actions.
          By connecting your Sleeper account, you acknowledge and accept the following:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Dynasty Command does not store your Sleeper password at any point.",
            "You are solely responsible for the security of your Sleeper account.",
            "You are responsible for all actions initiated through Dynasty Command on your behalf.",
            "Revoking access or disconnecting Sleeper is your responsibility — Dynasty Command does not automatically revoke tokens.",
            "If your account is compromised, notify Sleeper directly. StatChasers has no ability to modify Sleeper account credentials.",
          ]} />
        </div>
      </Section>

      {/* 3. Platform Features */}
      <Section icon={Server} title="Platform Features & Actions">
        <BodyText>
          Dynasty Command provides tools that may interact with your Sleeper account on your behalf.
          These include but are not limited to:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Analyzing your leagues, rosters, and trade history",
            "Calculating trade values and projecting fantasy outcomes",
            "Submitting trade offers, counteroffers, acceptances, and rejections",
            "Submitting lineup changes and waiver claims",
            "Sending direct messages to other Sleeper users",
            "Interacting with the Sleeper API on your behalf",
            "Providing rankings, projections, and recommendations",
          ]} />
        </div>
        <div className="mt-3">
          <BodyText>
            All actions performed through Dynasty Command are user-authorized. StatChasers does not
            initiate actions without your explicit instruction. You accept full responsibility for
            all submitted actions, including trades, lineup changes, and messages.
          </BodyText>
        </div>
      </Section>

      {/* 4. No Affiliation With Sleeper */}
      <Section icon={AlertCircle} title="No Affiliation With Sleeper"
        iconColor="#fb923c" iconBg="rgba(251,146,60,0.10)">
        <BodyText>
          StatChasers and Dynasty Command are independent products. We are not affiliated with,
          endorsed by, sponsored by, or officially connected to Sleeper in any way. Use of the
          Sleeper name, logo references, or API is for interoperability purposes only. Any
          trademarks belong to their respective owners.
        </BodyText>
      </Section>

      {/* 5. No Guarantees / As Is */}
      <Section icon={AlertCircle} title='Service Provided "As Is"'
        iconColor="#f472b6" iconBg="rgba(244,114,182,0.10)">
        <BodyText>
          The Service is provided on an "as is" and "as available" basis without warranties of any kind,
          either express or implied. StatChasers expressly disclaims all warranties, including but not limited to:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Continuous, uninterrupted, or error-free platform availability",
            "Accuracy of trade values, projections, rankings, or recommendations",
            "Successful execution of any Sleeper action (trade, lineup, waiver, DM)",
            "Profitability, winning, or any specific fantasy outcome",
            "Compatibility with future Sleeper API changes",
          ]} />
        </div>
        <div className="mt-3">
          <BodyText>
            Beta features and experimental tools are provided with no guarantees of stability, accuracy,
            or continued availability. Use them at your own risk.
          </BodyText>
        </div>
      </Section>

      {/* 6. Fantasy Advice Disclaimer */}
      <Section icon={BarChart2} title="Fantasy Advice Disclaimer"
        iconColor="#34d399" iconBg="rgba(52,211,153,0.10)">
        <BodyText>
          All rankings, trade values, projections, recommendations, and analytics provided by Dynasty Command
          are for informational purposes only. They do not constitute professional advice of any kind.
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "You make all final fantasy decisions — Dynasty Command provides data, not instructions.",
            "StatChasers is not responsible for fantasy losses, missed playoffs, poor draft picks, or bad trades.",
            "StatChasers is not responsible for financial losses in paid fantasy leagues or contests.",
            "StatChasers is not responsible for league disputes arising from actions taken through the platform.",
          ]} />
        </div>
      </Section>

      {/* 7. Limitation of Liability */}
      <Section icon={UserX} title="Limitation of Liability"
        iconColor="#60a5fa" iconBg="rgba(96,165,250,0.10)">
        <BodyText>
          To the maximum extent permitted by applicable law, StatChasers and Dynasty Command shall not be
          liable for any indirect, incidental, special, consequential, or punitive damages, including but
          not limited to:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Lost leagues, prizes, or entry fees",
            "Rejected trades, failed lineup changes, or missed waiver claims",
            "Sleeper API outages, rate limits, or service interruptions",
            "Fantasy season losses or team performance outcomes",
            "Account suspension or termination (by StatChasers or Sleeper)",
            "Duplicate submissions or accidental API actions",
            "Data loss or inaccurate player/league data",
            "Indirect or consequential damages of any kind",
          ]} />
        </div>
        <div className="mt-3">
          <BodyText>
            If StatChasers is found liable for any claim, total liability shall not exceed the amount
            you paid to StatChasers in the twelve (12) months preceding the claim, or $10 USD,
            whichever is greater.
          </BodyText>
        </div>
      </Section>

      {/* 8. Acceptable Use */}
      <Section icon={Sliders} title="Acceptable Use">
        <BodyText>
          By using Dynasty Command, you agree not to engage in any of the following:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Spamming Sleeper users via Dynasty Command messaging features",
            "Abusing bulk trade or bulk messaging tools to harass other managers",
            "Attempting to reverse engineer, decompile, or extract source code from the platform",
            "Scraping, crawling, or bulk downloading data from Dynasty Command",
            "Attempting unauthorized access to other users' accounts or data",
            "Overloading or abusing Sleeper APIs or Dynasty Command infrastructure",
            "Exploiting bugs, vulnerabilities, or unintended behaviors for personal gain",
            "Bypassing subscription limits, paywalls, or feature gates",
            "Using automation, bots, or scripts to interact with the platform",
          ]} />
        </div>
      </Section>

      {/* 9. Suspension / Termination */}
      <Section icon={UserX} title="Suspension & Termination"
        iconColor="#f87171" iconBg="rgba(248,113,113,0.10)">
        <BodyText>
          StatChasers reserves the right to suspend, restrict, or terminate your access to Dynasty Command
          at any time, with or without notice, for any of the following reasons:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Abuse of platform features or other users",
            "Automation misuse or bot activity",
            "Spam behavior via messaging or trade tools",
            "Sleeper API abuse that may impact platform stability",
            "Malicious, fraudulent, or illegal activity",
            "Violation of any provision of these Terms",
          ]} />
        </div>
        <div className="mt-3">
          <BodyText>
            Termination does not limit StatChasers from pursuing any other remedies available at law or equity.
          </BodyText>
        </div>
      </Section>

      {/* 10. Subscription & Billing */}
      <Section icon={Database} title="Subscription & Billing"
        iconColor="#d4af37" iconBg="rgba(212,175,55,0.10)">
        <BodyText>
          Dynasty Command may offer free and paid subscription tiers. By subscribing to a paid tier, you agree:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Subscription pricing is subject to change with reasonable notice",
            "Cancellation takes effect at the end of the current billing period",
            "Refunds are issued at StatChasers' sole discretion — no automatic refunds are guaranteed",
            "Payment is processed by Stripe; StatChasers does not store card data",
            "Chargebacks or disputes must be raised with StatChasers support before initiating with your bank",
            "Failure to pay may result in downgrade or suspension of premium features",
          ]} />
        </div>
      </Section>

      {/* 11. Third-Party Services */}
      <Section icon={Link2} title="Third-Party Services"
        iconColor="#fb923c" iconBg="rgba(251,146,60,0.10)">
        <BodyText>
          Dynasty Command relies on third-party services to operate. These services have their own
          terms and privacy policies, and their outages or changes are outside StatChasers' control:
        </BodyText>
        <div className="mt-3">
          <Bullets items={[
            "Sleeper — fantasy sports data, authentication, and real-time league actions",
            "Stripe — payment processing for premium subscriptions",
            "Discord — community support and optional integration features",
            "Cloudflare — content delivery, DDoS protection, and performance",
            "Analytics providers — aggregated usage metrics and error tracking",
          ]} />
        </div>
        <div className="mt-3">
          <BodyText>
            StatChasers is not responsible for service interruptions, data changes, or policy shifts
            by any third-party provider that affect Dynasty Command functionality.
          </BodyText>
        </div>
      </Section>

      {/* 12. Privacy & Cookies */}
      <Section icon={Cookie} title="Privacy & Cookies"
        iconColor="#a5b4fc" iconBg="rgba(99,102,241,0.10)">
        <BodyText>
          Your use of Dynasty Command is also governed by our Privacy Policy and Cookies policy, which
          are incorporated into these Terms by reference. Please review both documents carefully.
          By using the Service, you consent to our data practices as described in those documents.
        </BodyText>
      </Section>

      {/* 13. Changes To Terms */}
      <Section icon={FileText} title="Changes to These Terms">
        <BodyText>
          StatChasers may update these Terms of Service at any time. When changes are made, the "Last updated"
          date at the bottom of this page will be revised. Your continued use of Dynasty Command after
          any change constitutes your acceptance of the new terms. If you disagree with updated terms,
          discontinue use of the Service.
        </BodyText>
      </Section>

      {/* 14. Jurisdiction & Arbitration */}
      <Section icon={Shield} title="Jurisdiction & Dispute Resolution"
        iconColor="#94a3b8" iconBg="rgba(148,163,184,0.10)">
        <BodyText>
          These Terms shall be governed by and construed in accordance with applicable law. Any disputes
          arising from or related to these Terms or your use of Dynasty Command shall first be attempted
          to be resolved informally by contacting StatChasers support. If informal resolution fails,
          disputes may be subject to binding arbitration at StatChasers' discretion. You waive any right
          to participate in class action lawsuits against StatChasers to the extent permitted by law.
        </BodyText>
      </Section>

      {/* 15. Contact */}
      <Section icon={Mail} title="Contact"
        iconColor="#60a5fa" iconBg="rgba(96,165,250,0.10)">
        <BodyText>
          Questions, concerns, or legal notices regarding these Terms of Service should be directed to{" "}
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
