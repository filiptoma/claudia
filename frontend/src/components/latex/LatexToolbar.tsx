import { AlertCircle, Check, Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// The compile lifecycle, shared by the toolbar chip and useLatexCompile.
export type CompileStatus = "idle" | "compiling" | "success" | "error";

// Replaces EditorToolbar for LaTeX projects. Distinct, non-overlapping actions: **Compile** = the full
// build (resolves refs/citations/bibliography); **Auto-draft** = auto-render a fast draft as you type;
// the status chip shows Draft / Compiled / Compiling… / Error. Hints use the app's Tooltip component.
export default function LatexToolbar({
  status,
  draft = false,
  autoCompile,
  onToggleAutoCompile,
  onCompile,
  onDownload,
  canDownload,
}: {
  status: CompileStatus;
  /** Whether the current PDF came from a fast single-pass draft (refs/citations may be unresolved). */
  draft?: boolean;
  autoCompile: boolean;
  onToggleAutoCompile: (next: boolean) => void;
  /** Run a full compile. */
  onCompile?: () => void;
  /** Download the last compiled PDF. */
  onDownload?: () => void;
  canDownload: boolean;
}) {
  const compiling = status === "compiling";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            onClick={onCompile}
            disabled={!onCompile || compiling}
          >
            {compiling ? <Loader2 className="animate-spin" /> : <Play />}
            Compile
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {"Full build — resolves cross-references, citations & bibliography"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={autoCompile} onCheckedChange={onToggleAutoCompile} />
            <span className="max-sm:hidden">Auto-draft</span>
            <span className="sm:hidden">Auto</span>
          </label>
        </TooltipTrigger>
        <TooltipContent>
          Auto-render a quick draft as you type — references resolve when you Compile
        </TooltipContent>
      </Tooltip>

      <div className="ml-auto flex items-center gap-2">
        <CompileChip status={status} draft={draft} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              disabled={!onDownload || !canDownload}
            >
              <Download />
              <span className="max-sm:hidden">Download PDF</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download the compiled PDF</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// Compact status indicator mirroring the compile state machine. After a successful draft it shows
// "Draft" (with a tooltip hinting that Compile resolves references) rather than "Compiled".
function CompileChip({
  status,
  draft,
}: {
  status: CompileStatus;
  draft: boolean;
}) {
  if (status === "idle") return null;
  const map = {
    compiling: {
      icon: <Loader2 className="size-3.5 animate-spin" />,
      label: "Compiling…",
      cls: "text-muted-foreground",
      hint: undefined as string | undefined,
    },
    success: draft
      ? {
          icon: <Check className="size-3.5" />,
          label: "Draft",
          cls: "text-amber-600 dark:text-amber-400",
          hint: "Quick draft — references unresolved. Click Compile for the full build.",
        }
      : {
          icon: <Check className="size-3.5" />,
          label: "Compiled",
          cls: "text-emerald-600 dark:text-emerald-400",
          hint: "Full build — references, citations & bibliography resolved.",
        },
    error: {
      icon: <AlertCircle className="size-3.5" />,
      label: "Error",
      cls: "text-destructive",
      hint: undefined,
    },
  } as const;
  const s = map[status];
  const chip = (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-medium cursor-default",
        s.cls,
      )}
      aria-live="polite"
    >
      {s.icon}
      {s.label}
    </span>
  );
  if (!s.hint) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{s.hint}</TooltipContent>
    </Tooltip>
  );
}
