import { useState, useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

export function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const inIframe = window.self !== window.top;

  useEffect(() => {
    const fsHandler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fsHandler);
    const msgHandler = (e: MessageEvent) => {
      if (e.data?.type === "statchasers-fullscreen-changed") {
        setIsFullscreen(!!e.data.isFullscreen);
      }
    };
    window.addEventListener("message", msgHandler);
    return () => {
      document.removeEventListener("fullscreenchange", fsHandler);
      window.removeEventListener("message", msgHandler);
    };
  }, []);

  const toggle = () => {
    if (inIframe) {
      window.parent.postMessage(
        { type: isFullscreen ? "statchasers-fullscreen-exit" : "statchasers-fullscreen-request" },
        "*"
      );
    } else {
      if (!document.fullscreenElement && document.fullscreenEnabled) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // When embedded in an iframe the button lives on the parent page instead —
  // this prevents Divi's touch handlers from blocking the tap on mobile.
  if (inIframe) return null;

  return (
    <button
      onClick={toggle}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      className={`fixed top-3 right-3 z-[9999] flex items-center gap-2 rounded-lg font-bold text-xs tracking-wide shadow-lg transition-all duration-150 select-none ${
        isFullscreen
          ? "bg-primary text-primary-foreground px-3 py-2 shadow-primary/40 hover:bg-primary/90"
          : "bg-primary/90 text-primary-foreground px-3 py-2 shadow-primary/30 hover:bg-primary opacity-70 hover:opacity-100"
      }`}
    >
      {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
    </button>
  );
}
