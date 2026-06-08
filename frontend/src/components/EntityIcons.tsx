import {
  FileText,
  Folder as FolderIcon,
  Globe,
  Library,
  Lock,
  StickyNote,
  Users,
} from "lucide-react";
import type { Project, Visibility } from "../lib/types";
import { cn } from "@/lib/utils";

// Shared glyphs so the sidebar, header, breadcrumbs, and cards all show the same icon for the same
// kind of thing. My Workspace gets its own icon (a library of your notes) rather than a lock.
export const WorkspaceIcon = Library;
export const QuickNoteIcon = StickyNote;
export const DocIcon = FileText;
export const FolderGlyph = FolderIcon;

/** Icon for a project: the workspace glyph for My Workspace, otherwise a visibility glyph. */
export function ProjectGlyph({
  project,
  visibility,
  className,
}: {
  project: Pick<Project, "is_workspace">;
  visibility: Visibility;
  className?: string;
}) {
  if (project.is_workspace) return <Library className={className} />;
  if (visibility === "public")
    return <Globe className={cn("text-blue-600 dark:text-blue-400", className)} />;
  if (visibility === "shared") return <Users className={className} />;
  return <Lock className={className} />;
}
