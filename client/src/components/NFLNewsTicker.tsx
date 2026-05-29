import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/apiBase";

type NewsItem = {
  id: string;
  title: string;
  link: string;
  pubDate?: string | null;
  playerName?: string | null;
  image?: string | null;
};

/** Player headshot for a headline, falling back to the gold dot when there's no
 *  match or the image 404s (many deep players have no Sleeper headshot). */
function NewsIcon({ src, name }: { src?: string | null; name?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="h-1.5 w-1.5 rounded-full bg-[#d4af37] flex-shrink-0" />;
  }
  return (
    <img
      src={src}
      alt={name ?? ""}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-5 w-5 rounded-full object-cover bg-white/10 ring-1 ring-[#d4af37]/30 flex-shrink-0"
    />
  );
}

/**
 * StatChasers NFL News ticker — scrolling Rotowire headline links.
 *
 * Data is fetched server-side and cached (see GET /api/news/nfl); we only ever
 * render the headline + an outbound Rotowire link (no article bodies). If the
 * feed is empty or fails, the ticker renders nothing rather than breaking the
 * page. Intentionally lightweight + isolated so the same endpoint can later
 * power player pages or dashboard cards.
 */
export function NFLNewsTicker() {
  const [items, setItems] = useState<NewsItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/news/nfl`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setItems(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!items.length) return null;

  // Duplicate the list so the marquee can loop seamlessly (translateX -50%).
  const tickerItems = [...items, ...items];

  return (
    <div className="flex border-y border-[#d4af37]/20 bg-[#07111f] overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <div className="flex w-max animate-news-ticker">
          {tickerItems.map((item, index) => {
            const isClone = index >= items.length;
            return (
              <div
                key={`${item.id}-${index}`}
                className="flex items-center gap-2.5 px-5 py-1.5 whitespace-nowrap"
                aria-hidden={isClone}
              >
                <NewsIcon src={item.image} name={item.playerName ?? item.title} />
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={item.pubDate ?? undefined}
                  tabIndex={isClone ? -1 : 0}
                  className="text-[13px] text-white/75 hover:text-[#d4af37] transition-colors"
                >
                  {item.title}
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
