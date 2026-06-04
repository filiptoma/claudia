import { Check, Loader2, AlertCircle } from "lucide-react";
import { useSaveStatus } from "../lib/saveStatus";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Autosave status shown in the app bar (left of the mode switch). The "Saved" state shows just the
// checkmark + label; the exact time is on hover in a tooltip.
export default function SaveIndicator() {
  const status = useSaveStatus((s) => s.status);
  const savedAt = useSaveStatus((s) => s.savedAt);
  const retry = useSaveStatus((s) => s.retry);

  if (status === "saving")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  if (status === "error")
    return (
      <button
        className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-destructive"
        onClick={() => retry?.()}
      >
        <AlertCircle className="size-3.5" /> Save failed — retry
      </button>
    );
  if (status === "saved")
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-0.5 text-xs whitespace-nowrap text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" /> Saved
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {savedAt ? `Saved at ${savedAt.toLocaleTimeString()}` : "Saved"}
        </TooltipContent>
      </Tooltip>
    );
  return null;
}
