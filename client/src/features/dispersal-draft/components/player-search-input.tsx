import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { POS_COLOR } from "@dispersal/components/ui";

interface PlayerResult {
  id: string;
  name: string;
  position: string;
  team: string;
}

interface PlayerSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onPlayerSelect: (player: { name: string; position: string; team: string; sleeperId: string }) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function PlayerSearchInput({ value, onChange, onPlayerSelect, disabled, placeholder }: PlayerSearchInputProps) {
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateDropdownPos = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 2) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(value)}`);
        const data: PlayerResult[] = await res.json();
        setResults(data);
        if (data.length > 0) {
          updateDropdownPos();
          setOpen(true);
        } else {
          setOpen(false);
        }
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 280);
  }, [value]);

  useEffect(() => {
    const close = () => setOpen(false);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        className="bg-background border-border/50"
        placeholder={placeholder ?? "Bijan Robinson"}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { if (results.length > 0) { updateDropdownPos(); setOpen(true); } }}
        disabled={disabled}
        autoComplete="off"
      />
      {loading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">
          ···
        </div>
      )}
      {open && results.length > 0 && createPortal(
        <div
          style={dropdownStyle}
          className="bg-card border border-[var(--sc-border)] dark-any:border-white/10 rounded-xl shadow-2xl overflow-hidden"
        >
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/60 transition-colors text-left"
              onMouseDown={e => {
                e.preventDefault();
                onPlayerSelect({ name: p.name, position: p.position, team: p.team, sleeperId: p.id });
                setOpen(false);
              }}
            >
              <span className={`text-[10px] font-black w-7 shrink-0 ${POS_COLOR[p.position] ?? "text-muted-foreground"}`}>
                {p.position}
              </span>
              <span className="text-sm font-medium flex-1 truncate">{p.name}</span>
              <span className="text-[11px] text-muted-foreground font-mono shrink-0">{p.team || "FA"}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
