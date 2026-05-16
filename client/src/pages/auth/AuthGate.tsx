import { useState } from "react";
import { Loader2, User, LogOut, Shield, Unlink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  LandingScreen, LoginScreen, SignupEmailScreen, SignupCodeScreen,
  SignupPasswordScreen, ForgotEmailScreen, ForgotCodeScreen,
  ForgotPasswordScreen, ForgotDoneScreen,
  type AuthScreen, type AuthState,
} from "./AuthScreens";
import { ConnectSleeperScreen } from "./ConnectSleeper";

const defaultState: AuthState = { email: "", verifiedToken: "" };

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#060d1a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[#0b3a7a]/40 border border-[#d4af37]/30 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-6 h-6">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#d4af37" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <Loader2 className="w-5 h-5 text-[#d4af37]/60 animate-spin" />
      </div>
    </div>
  );
}

// Floating account menu shown when user is fully logged in
function AccountButton() {
  const { user, sleeperInfo, logout, onSleeperDisconnected } = useAuth();
  const [open, setOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    await onSleeperDisconnected();
    setDisconnecting(false);
    setOpen(false);
  }

  return (
    <div className="fixed top-3 right-3 z-50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full bg-[#0b3a7a]/80 border border-[#d4af37]/30 flex items-center justify-center hover:border-[#d4af37]/60 transition-colors shadow-lg"
        data-testid="button-account-menu"
        title="Account"
      >
        <User className="w-3.5 h-3.5 text-[#d4af37]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 w-64 bg-[#0d1f35] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8">
              <p className="text-[11px] text-white/40 font-medium uppercase tracking-wide">Account</p>
              <p className="text-sm font-semibold text-white truncate mt-0.5">{user?.email}</p>
            </div>

            {sleeperInfo?.username && (
              <div className="px-4 py-3 border-b border-white/8">
                <p className="text-[11px] text-white/40 font-medium uppercase tracking-wide">Sleeper</p>
                <div className="flex items-center justify-between mt-0.5">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    <p className="text-sm font-semibold text-white">{sleeperInfo.username}</p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="flex items-center gap-1 text-[11px] text-white/30 hover:text-red-400 transition-colors"
                    data-testid="button-disconnect-sleeper"
                  >
                    <Unlink className="w-3 h-3" />
                    {disconnecting ? "…" : "Disconnect"}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Unauthenticated flow — manages which auth screen to show
function UnauthFlow({ onLoginSuccess }: { onLoginSuccess: (token: string) => void }) {
  const [screen, setScreen] = useState<AuthScreen>("landing");
  const [flowState, setFlowState] = useState<AuthState>(defaultState);

  function navigate(next: AuthScreen, state?: Partial<AuthState>) {
    if (state) setFlowState(prev => ({ ...prev, ...state }));
    setScreen(next);
  }

  const props = { onNavigate: navigate, state: flowState, onLoginSuccess };

  switch (screen) {
    case "landing":        return <LandingScreen {...props} />;
    case "login":          return <LoginScreen {...props} />;
    case "signup-email":   return <SignupEmailScreen {...props} />;
    case "signup-code":    return <SignupCodeScreen {...props} />;
    case "signup-password":return <SignupPasswordScreen {...props} />;
    case "forgot-email":   return <ForgotEmailScreen {...props} />;
    case "forgot-code":    return <ForgotCodeScreen {...props} />;
    case "forgot-password":return <ForgotPasswordScreen {...props} />;
    case "forgot-done":    return <ForgotDoneScreen {...props} />;
    default:               return <LandingScreen {...props} />;
  }
}

// The outer gate — decides which layer to render
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, onLoginSuccess } = useAuth();

  if (status === "loading") return <LoadingScreen />;

  if (status === "unauthenticated") {
    return <UnauthFlow onLoginSuccess={onLoginSuccess} />;
  }

  if (status === "needs-sleeper") {
    return <ConnectSleeperScreen />;
  }

  // ready — show the app (account menu is embedded in the header)
  return <>{children}</>;
}
