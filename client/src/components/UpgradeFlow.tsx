import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  LandingScreen, LoginScreen, SignupEmailScreen, SignupCodeScreen,
  SignupPasswordScreen, ForgotEmailScreen, ForgotCodeScreen,
  ForgotPasswordScreen, ForgotDoneScreen,
  type AuthScreen, type AuthState,
} from "@/pages/auth/AuthScreens";
import { ConnectSleeperScreen } from "@/pages/auth/ConnectSleeper";

/**
 * UpgradeFlow — overlays the StatChasers auth screens on top of the app.
 *
 * Used by AccessGate (full-mode gate) and the header "Login for Full Access"
 * button. Wraps the existing AuthScreens flow and, after DC login succeeds,
 * automatically routes the user into the Sleeper-token connect step if they
 * still lack one. When they reach `full` access (or close the overlay),
 * `onDone` is called.
 *
 * Each AuthScreens screen renders its own full-page layout — no separate
 * modal container is needed. We just render the screen at z-50 above the
 * app.
 */

const defaultState: AuthState = { email: "", verifiedToken: "" };

export function UpgradeFlow({
  initialScreen = "login",
  requireSleeperToken = true,
  onDone,
}: {
  initialScreen?: AuthScreen;
  requireSleeperToken?: boolean;
  onDone?: () => void;
}) {
  const { onLoginSuccess, isAuthenticatedUser, hasSleeperToken } = useAuth();
  const [screen, setScreen] = useState<AuthScreen>(initialScreen);
  const [flowState, setFlowState] = useState<AuthState>(defaultState);

  function navigate(next: AuthScreen, state?: Partial<AuthState>) {
    if (state) setFlowState(prev => ({ ...prev, ...state }));
    setScreen(next);
  }

  async function handleLoginSuccess(token: string) {
    await onLoginSuccess(token);
    // After DC login, AuthContext re-bootstraps. If the user already has a
    // Sleeper token attached, we're done. Otherwise, fall through to the
    // Sleeper OTP/captcha flow.
  }

  const props = {
    onNavigate: navigate,
    state: flowState,
    onLoginSuccess: handleLoginSuccess,
  };

  // Phase 2: if DC is authenticated, no Sleeper token, and the caller wants
  // a full upgrade, swap to the Sleeper credentials flow. AuthContext's
  // onSleeperConnected will trigger another checkSession and the gate will
  // then unblock.
  if (isAuthenticatedUser && !hasSleeperToken && requireSleeperToken) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <ConnectSleeperScreen />
      </div>
    );
  }

  // Phase 3: if we've reached full access, signal done.
  if (isAuthenticatedUser && (hasSleeperToken || !requireSleeperToken)) {
    queueMicrotask(() => onDone?.());
    return null;
  }

  let content: React.ReactNode;
  switch (screen) {
    case "landing":        content = <LandingScreen {...props} />; break;
    case "login":          content = <LoginScreen {...props} />; break;
    case "signup-email":   content = <SignupEmailScreen {...props} />; break;
    case "signup-code":    content = <SignupCodeScreen {...props} />; break;
    case "signup-password":content = <SignupPasswordScreen {...props} />; break;
    case "forgot-email":   content = <ForgotEmailScreen {...props} />; break;
    case "forgot-code":    content = <ForgotCodeScreen {...props} />; break;
    case "forgot-password":content = <ForgotPasswordScreen {...props} />; break;
    case "forgot-done":    content = <ForgotDoneScreen {...props} />; break;
    default:               content = <LandingScreen {...props} />; break;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Close button — drops the user back to read-only tools without
          completing the upgrade. */}
      <button
        type="button"
        onClick={() => onDone?.()}
        data-testid="button-close-upgrade-flow"
        className="fixed top-4 right-4 z-[60] w-9 h-9 rounded-full bg-black/40 border border-white/15 text-white/70 hover:text-white hover:bg-black/60 transition-colors flex items-center justify-center"
        aria-label="Close"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
      {content}
    </div>
  );
}
