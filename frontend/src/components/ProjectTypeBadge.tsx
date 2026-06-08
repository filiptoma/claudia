import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectType } from "../lib/types";

// A tiny monospace pill denoting a project's source format — `.tex` for LaTeX, `.md` for Markdown.
// Cool cyan for LaTeX, warm orange for Markdown — high contrast between the two.
// Renders nothing for an unknown/missing type (e.g. a public-projects row from before the `type` column existed).
export default function ProjectTypeBadge({
  type,
  className,
}: {
  type?: ProjectType | null;
  className?: string;
}) {
  if (type !== "markdown" && type !== "latex") return null;
  const isLatex = type === "latex";
  return (
    <Badge
      variant="outline"
      title={isLatex ? "LaTeX project" : "Markdown project"}
      className={cn(
        "px-1.5 py-0 font-mono text-[0.65rem] leading-5",
        isLatex
          ? "border-violet-400/60 bg-violet-100 text-violet-800 dark:border-violet-400/50 dark:bg-violet-400/15 dark:text-violet-400"
          : "border-lime-400/60 bg-lime-100 text-lime-800 dark:border-lime-300/50 dark:bg-lime-300/15 dark:text-lime-300",
        className,
      )}
    >
      <span className="font-extrabold text-xs">{isLatex ? ".tex" : ".md"}</span>
    </Badge>
  );
}
