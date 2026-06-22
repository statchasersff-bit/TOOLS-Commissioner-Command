import { useState, useEffect } from "react";
import { useLocation } from "@dispersal/router";
import { useCreateDraftRoom } from "@dispersal/api";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader, SectionTitle, Chip, CHIP_TONE } from "@dispersal/components/ui";
import { useRecentRooms, type RecentRoom } from "@dispersal/hooks/use-recent-rooms";

export default function Home() {
  const [, setLocation] = useLocation();
  const [joinCode, setJoinCode] = useState("");
  const { toast } = useToast();
  const createDraftRoom = useCreateDraftRoom();
  const { getRecentRooms, removeRoom } = useRecentRooms();
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);

  useEffect(() => {
    setRecentRooms(getRecentRooms());
  }, []);

  const onJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setLocation(`/${joinCode.toUpperCase()}`);
  };

  const onCreate = () => {
    createDraftRoom.mutate({
      data: {
        leagueName: "My League",
        numOrphanSlots: 2,
        draftFormat: "snake",
        timeBankSeconds: null,
        commissionerName: "Commissioner"
      }
    }, {
      onSuccess: (room) => {
        localStorage.setItem(`draft_${room.shareCode}_commish`, room.commissionerToken);
        setLocation(`/${room.shareCode}/setup`);
      },
      onError: () => {
        toast({ title: "Could not create room", description: "Please try again.", variant: "destructive" });
      }
    });
  };

  const handleRemove = (e: React.MouseEvent, shareCode: string) => {
    e.stopPropagation();
    removeRoom(shareCode);
    setRecentRooms(prev => prev.filter(r => r.shareCode !== shareCode));
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Dispersal Draft"
        subtitle="The command center for running dynasty fantasy football dispersal drafts in real-time."
      />

      {/* Recent rooms */}
      {recentRooms.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHeader title="Your Rooms" />
          <div className="divide-y divide-[var(--sc-border)] dark-any:divide-white/5">
            {recentRooms.map(r => (
              <div
                key={r.shareCode}
                onClick={() => setLocation(`/${r.shareCode}`)}
                className="flex items-center gap-4 px-4 md:px-5 py-3 hover:bg-[var(--sc-card-soft)] dark-any:hover:bg-white/[0.02] cursor-pointer transition-colors group"
              >
                <div className={cn("shrink-0 w-1.5 h-8 rounded-full", r.role === "commissioner" ? "bg-[#d4af37]" : "bg-muted-foreground/30")} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-foreground truncate">{r.leagueName}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">{r.shareCode}</span>
                    <Chip className={r.role === "commissioner" ? CHIP_TONE.gold : CHIP_TONE.slate}>{r.role}</Chip>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-semibold text-[var(--sc-gold-deep)] dark-any:text-[#d4af37] opacity-0 group-hover:opacity-100 transition-opacity">
                    Enter →
                  </span>
                  <button
                    onClick={(e) => handleRemove(e, r.shareCode)}
                    className="text-muted-foreground/40 hover:text-destructive transition-colors text-lg leading-none min-w-[2.5rem] min-h-[2.5rem] flex items-center justify-center rounded-lg"
                    title="Remove from list"
                  >×</button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Join + Create */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Join */}
        <Panel className="p-6 flex flex-col">
          <SectionTitle>Join a Room</SectionTitle>
          <p className="text-sm text-muted-foreground mb-5">Enter the share code your commissioner sent you.</p>
          <form onSubmit={onJoin} className="flex flex-col gap-3 mt-auto">
            <Input
              placeholder="E.G. JOHNDOE-A3K9M"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              className="font-mono text-center tracking-widest text-lg h-12 uppercase"
              maxLength={20}
            />
            <Button
              type="submit"
              variant="secondary"
              className="h-12 font-bold"
              disabled={!joinCode.trim()}
            >
              Join Room
            </Button>
          </form>
        </Panel>

        {/* Create */}
        <Panel className="p-6 flex flex-col">
          <SectionTitle>Create a Room</SectionTitle>
          <p className="text-sm text-muted-foreground mb-5">Set up a new dispersal draft as commissioner. You'll configure your league details on the next page.</p>
          <div className="mt-auto">
            <Button
              className="w-full h-12 font-bold"
              onClick={onCreate}
              disabled={createDraftRoom.isPending}
            >
              {createDraftRoom.isPending ? "Creating..." : "Get Started →"}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
