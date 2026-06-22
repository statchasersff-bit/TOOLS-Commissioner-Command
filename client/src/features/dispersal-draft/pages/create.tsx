import { useLocation } from "@dispersal/router";
import { useCreateDraftRoom } from "@dispersal/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Panel } from "@dispersal/components/ui";

const createFormSchema = z.object({
  leagueName: z.string().min(1, "League name is required"),
  numOrphanSlots: z.coerce.number().min(1).max(20),
  draftFormat: z.enum(["snake", "linear", "3rr"]),
  timeBankMinutes: z.coerce.number().min(0).optional(),
  commissionerName: z.string().min(1, "Your name is required")
});

export default function Create() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createDraftRoom = useCreateDraftRoom();

  const form = useForm<z.infer<typeof createFormSchema>>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      leagueName: "",
      numOrphanSlots: 10,
      draftFormat: "snake",
      timeBankMinutes: 0,
      commissionerName: ""
    }
  });

  const onSubmit = (values: z.infer<typeof createFormSchema>) => {
    createDraftRoom.mutate({
      data: {
        leagueName: values.leagueName,
        numOrphanSlots: values.numOrphanSlots,
        draftFormat: values.draftFormat,
        timeBankSeconds: values.timeBankMinutes ? values.timeBankMinutes * 60 : null,
        commissionerName: values.commissionerName
      }
    }, {
      onSuccess: (room) => {
        localStorage.setItem(`draft_${room.shareCode}_commish`, room.commissionerToken);
        toast({ title: "Draft Room Created", description: "You are the commissioner." });
        setLocation(`/${room.shareCode}/setup`);
      },
      onError: (err) => {
        toast({ title: "Error", description: err.data?.error || "Could not create room", variant: "destructive" });
      }
    });
  };

  return (
    <div className="w-full max-w-lg mx-auto space-y-6">
      <button
        onClick={() => setLocation("/")}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
      >
        ← Back
      </button>

      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-[var(--sc-blue)] dark-any:text-foreground">Create a Draft Room</h1>
        <span className="sc-section-rule" />
        <p className="text-sm mt-2 text-muted-foreground">Set up your dispersal draft. You'll import assets on the next page.</p>
      </div>

      <Panel className="p-6">
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="leagueName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase font-bold tracking-widest text-muted-foreground">League Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Dynasty League 2024" className="bg-background border-border/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="numOrphanSlots"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs uppercase font-bold tracking-widest text-muted-foreground">Orphan Teams</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value.toString()}>
                        <FormControl>
                          <SelectTrigger className="bg-background border-border/50">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
                            <SelectItem key={n} value={n.toString()}>{n} Teams</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="draftFormat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs uppercase font-bold tracking-widest text-muted-foreground">Format</FormLabel>
                      <div className="flex items-center gap-2">
                        <Select
                          onValueChange={field.onChange}
                          value={field.value === "3rr" ? "snake" : field.value}
                          disabled={field.value === "3rr"}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-background border-border/50 flex-1">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="snake">Snake</SelectItem>
                            <SelectItem value="linear">Linear</SelectItem>
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-1.5 cursor-pointer shrink-0 select-none border border-border/50 rounded px-2.5 py-2 bg-background hover:bg-secondary/50 transition-colors">
                          <input
                            type="checkbox"
                            className="accent-primary w-3.5 h-3.5"
                            checked={field.value === "3rr"}
                            onChange={e => field.onChange(e.target.checked ? "3rr" : "snake")}
                          />
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">3RR</span>
                        </label>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="timeBankMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase font-bold tracking-widest text-muted-foreground">Time Bank (Minutes)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="Optional (e.g. 10)" className="bg-background border-border/50" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="commissionerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase font-bold tracking-widest text-muted-foreground">Your Name (Commissioner)</FormLabel>
                    <FormControl>
                      <Input placeholder="Commish" className="bg-background border-border/50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full h-11 font-bold mt-2"
                disabled={createDraftRoom.isPending}
              >
                {createDraftRoom.isPending ? "Creating..." : "Create Draft Room →"}
              </Button>
            </form>
          </Form>
      </Panel>
    </div>
  );
}
