import { useMemo, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Bug,
  ChevronDown,
  ChevronRight,
  Code2,
  FilePlus,
  FolderPlus,
  Lightbulb,
  Lock,
  LogOut,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import LoginModal from "./LoginModal";
import ProfileAvatar from "./ProfileAvatar";
import ActionsMenu from "./ActionsMenu";
import type { MenuAction } from "./ActionsMenu";
import {
  DocIcon,
  FolderGlyph,
  ProjectGlyph,
  QuickNoteIcon,
} from "./EntityIcons";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useTree } from "../hooks/useTree";
import type { DocMeta } from "../hooks/useTree";
import { useTreeActions } from "../hooks/useTreeActions";
import { useRouteContext } from "../hooks/useRouteContext";
import { useQuickNotes } from "../hooks/useQuickNotes";
import { useSidebar } from "../context/SidebarContext";
import {
  canConfigureProject,
  canEditDocument,
  canEditFolder,
  canEditProject,
  documentGrantRole,
  folderGrantRole,
  projectVisibility,
} from "../lib/access";
import {
  docPath,
  docSplitPath,
  folderPath,
  notePath,
  notesPath,
  noteSplitPath,
  projectPath,
  projectSettingsPath,
} from "../lib/paths";
import { docLabel } from "../lib/labels";
import { SOURCE_URL } from "../lib/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Folder, MemberRole, Project, Visibility } from "../lib/types";
import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useIsTouch } from "../hooks/useIsTouch";
import { useReorder } from "../hooks/useReorder";
import { useReorderMode } from "../lib/reorderMode";
import Reorderable from "./dnd/Reorderable";
import SortableItem from "./dnd/SortableItem";
import DragGrip from "./dnd/DragGrip";

// Floating previews shown under the cursor while dragging a sidebar row (the real row goes invisible).
// Kept simple — icon + label on an opaque, lifted surface — so the drop animation lands cleanly.
function folderOverlay(f: Folder) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-sidebar px-2 py-1.5 text-sm text-sidebar-foreground shadow-lg ring-1 ring-sidebar-border">
      <FolderGlyph className="size-3.75 shrink-0 text-muted-foreground" />
      <span className="truncate">{f.name}</span>
    </div>
  );
}
function docOverlay(d: DocMeta) {
  const Icon = d.is_quick_note ? QuickNoteIcon : DocIcon;
  return (
    <div className="flex items-center gap-2 rounded-md bg-sidebar px-2 py-1.5 text-sm text-sidebar-foreground shadow-lg ring-1 ring-sidebar-border">
      <Icon className="size-3.75 shrink-0 text-muted-foreground" />
      <span className="truncate">{docLabel(d)}</span>
    </div>
  );
}

export default function Sidebar({
  drawerOpen,
  onCloseDrawer,
}: {
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const {
    currentProject,
    folder: activeFolder,
    doc: activeDoc,
  } = useRouteContext();
  const { user, uid, role, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { folders, documents, members, grants, refresh } = useTree();
  const { notes: quickNotes } = useQuickNotes();
  const { id: activeNoteId } = useParams();
  const actions = useTreeActions();
  const navigate = useNavigate();
  const { collapsed: sidebarCollapsed } = useSidebar();

  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  const reorderActive = useReorderMode((s) => s.active);
  const reorder = useReorder();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showLogin, setShowLogin] = useState(false);

  const proj = currentProject;
  const myRole = useMemo(() => {
    const m = new Map<string, MemberRole>();
    for (const x of members) if (x.user_id === uid) m.set(x.project_id, x.role);
    return m;
  }, [members, uid]);
  const memberCount = (id: string) =>
    members.filter((m) => m.project_id === id).length;
  const canEdit = proj
    ? canEditProject(proj, role, uid, myRole.get(proj.id))
    : false;
  const canConfigure = proj ? canConfigureProject(proj, role, uid) : false;
  const visOf = (p: Project): Visibility =>
    projectVisibility(p, memberCount(p.id));

  const collapse = (id: string, value: boolean) =>
    setCollapsed((s) => {
      if (s.has(id) === value) return s;
      const n = new Set(s);
      if (value) n.add(id);
      else n.delete(id);
      return n;
    });

  const onCreateProject = async () => {
    const r = await actions.newProject();
    if (!r) return;
    onCloseDrawer();
    // LaTeX projects open their seeded main.tex straight into split mode; markdown opens the root.
    navigate(r.mainDoc ? docSplitPath(r.project.slug, r.mainDoc, folders) : projectPath(r.project.slug));
  };
  const onCreateDoc = async (p: Project, folderId: string | null) => {
    const doc = await actions.newDocument(p, folderId);
    if (doc) {
      onCloseDrawer();
      navigate(docSplitPath(p.slug, doc, folders));
    }
  };
  const onNewQuickNote = async (p: Project) => {
    const note = await actions.newQuickNote();
    if (note) {
      onCloseDrawer();
      navigate(noteSplitPath(p.slug, note.slug));
    }
  };
  const onDeleteFolder = async (
    p: Project,
    folderId: string,
    folderObj: Parameters<typeof actions.deleteFolder>[0],
  ) => {
    const wasActive =
      activeFolder?.id === folderId ||
      documents.some((d) => d.folder_id === folderId && d.id === activeDoc?.id);
    if ((await actions.deleteFolder(folderObj)) && wasActive)
      navigate(projectPath(p.slug));
  };
  const onDeleteDoc = async (p: Project, d: DocMeta) => {
    if ((await actions.deleteDocument(d)) && activeDoc?.id === d.id)
      navigate(projectPath(p.slug));
  };
  const onDeleteProject = async (p: Project) => {
    if (await actions.deleteProject(p)) navigate("/");
  };
  const onSignOut = async () => {
    await logout();
    await refresh();
    onCloseDrawer();
    navigate("/");
  };

  // ---- doc row ----
  const docRow = (
    d: DocMeta,
    p: Project,
    editable: boolean,
    folder: Folder | null,
  ) => {
    const active = activeDoc?.id === d.id;
    const Icon = d.is_quick_note ? QuickNoteIcon : DocIcon;
    const folderSlug = folder?.slug ?? null;
    const isPrivate = d.is_private || !!folder?.is_private;
    // A "view only" / "comment only" lock (on the doc OR its folder) hides rename/delete here too (the
    // DB enforces it regardless; this just doesn't dangle affordances that would fail).
    const docEditable =
      editable && canEditDocument(p, d, folder, role, uid, myRole.get(p.id), documentGrantRole(grants, d, uid));
    // Permissions are intentionally NOT here: folder/document access is managed only from the Project
    // settings page, so the sidebar menu doesn't offer a shortcut that lives in two places.
    const menu: MenuAction[] = [
      {
        label: "Rename",
        icon: <Pencil />,
        onSelect: () => void actions.editDocument(d),
      },
      {
        label: "Delete",
        icon: <Trash2 />,
        danger: true,
        separatorBefore: true,
        onSelect: () => void onDeleteDoc(p, d),
      },
    ];
    // Drag to reorder: always on non-touch (drag the row, a click still opens it), and in touch "Change
    // order" mode otherwise — which swaps tap-to-open + ⋯ for a grip handle.
    const dndOn = editable && (!isTouch || reorderActive);
    const touchReorder = isTouch && reorderActive && editable;
    return (
      <SortableItem key={d.id} id={d.id} disabled={!dndOn}>
        {({ setNodeRef, listeners, style, isDragging }) => (
          <div
            ref={setNodeRef}
            style={style}
            {...(dndOn && !touchReorder ? listeners : {})}
            className={cn(
              "group flex items-center gap-1 rounded-md pr-1 transition-colors",
              active ? "bg-primary/15" : "hover:bg-sidebar-accent",
              dndOn && !touchReorder && "cursor-grab active:cursor-grabbing",
              isDragging && "opacity-0",
            )}
          >
            <Link
              to={docPath(p.slug, folderSlug, d.slug)}
              onClick={onCloseDrawer}
              tabIndex={touchReorder ? -1 : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm max-md:py-2.5",
                active ? "font-medium text-foreground" : "text-sidebar-foreground",
                touchReorder && "pointer-events-none",
              )}
            >
              <Icon
                className={cn(
                  "size-3.75 shrink-0",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{docLabel(d)}</span>
              {isPrivate && (
                <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Private" />
              )}
            </Link>
            {touchReorder ? (
              <DragGrip listeners={listeners} className="size-7 shrink-0" />
            ) : (
              docEditable && !isMobile && <ActionsMenu actions={menu} />
            )}
          </div>
        )}
      </SortableItem>
    );
  };

  // ---- project tree ----
  const renderTree = (p: Project, editable: boolean) => {
    const projectFolders = folders.filter((f) => f.project_id === p.id);
    // Quick notes live in their own sidebar section (and /notes), not the project tree.
    const rootDocs = documents.filter(
      (d) => d.project_id === p.id && !d.folder_id && !d.is_quick_note,
    );
    const empty = projectFolders.length === 0 && rootDocs.length === 0;
    const dndOn = editable && (!isTouch || reorderActive);
    const touchReorder = isTouch && reorderActive && editable;

    // One folder row + its (nested, separately sortable) documents. Used as the folders list's renderItem.
    const folderItem = (f: Folder) => {
      const isCollapsed = collapsed.has(f.id);
      const folderDocs = documents.filter((d) => d.folder_id === f.id);
      const folderActive = activeFolder?.id === f.id;
      // A locked folder hides its edit affordances for non-owners (DB enforces it regardless).
      const folderEditable =
        editable && canEditFolder(p, f, role, uid, myRole.get(p.id), folderGrantRole(grants, f.id, uid));
      const menu: MenuAction[] = [
        { label: "New document", icon: <FilePlus />, onSelect: () => void onCreateDoc(p, f.id) },
        { label: "Rename", icon: <Pencil />, onSelect: () => void actions.editFolder(f) },
        // Permissions live only on the Project settings page (see the doc menu above).
        {
          label: "Delete",
          icon: <Trash2 />,
          danger: true,
          separatorBefore: true,
          onSelect: () => void onDeleteFolder(p, f.id, f),
        },
      ];
      return (
        <SortableItem key={f.id} id={f.id} disabled={!dndOn}>
          {({ setNodeRef, listeners, style, isDragging }) => (
            <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-0")}>
              <div
                // The drag handle is the folder HEADER only — dragging a child document grabs the doc
                // (its own nested sortable list below), never the whole folder.
                {...(dndOn && !touchReorder ? listeners : {})}
                className={cn(
                  "group flex items-center gap-0.5 rounded-md pr-1 transition-colors",
                  folderActive ? "bg-primary/15" : "hover:bg-sidebar-accent",
                  dndOn && !touchReorder && "cursor-grab active:cursor-grabbing",
                )}
              >
                <button
                  className={cn(
                    "ml-1 flex size-5 max-md:size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground",
                    touchReorder && "pointer-events-none opacity-40",
                  )}
                  onClick={() => collapse(f.id, !isCollapsed)}
                  aria-label={isCollapsed ? "Expand" : "Collapse"}
                  tabIndex={touchReorder ? -1 : undefined}
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>
                <Link
                  to={folderPath(p.slug, f.slug)}
                  // Clicking a collapsed folder reveals its contents as well as opening it.
                  onClick={() => {
                    collapse(f.id, false);
                    onCloseDrawer();
                  }}
                  tabIndex={touchReorder ? -1 : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-1 text-sm max-md:py-2.5",
                    folderActive ? "font-medium text-foreground" : "text-sidebar-foreground",
                    touchReorder && "pointer-events-none",
                  )}
                >
                  <FolderGlyph
                    className={cn(
                      "size-3.75 shrink-0",
                      folderActive ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {f.is_private && (
                    <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Private" />
                  )}
                </Link>
                {touchReorder ? (
                  <DragGrip listeners={listeners} className="size-7 shrink-0" />
                ) : (
                  folderEditable && !isMobile && <ActionsMenu actions={menu} />
                )}
              </div>
              {!isCollapsed && (
                <div className="my-0.5 ml-4 border-l border-sidebar-border pl-1">
                  <Reorderable
                    items={folderDocs}
                    strategy={verticalListSortingStrategy}
                    enabled={dndOn}
                    touch={isTouch}
                    onReorder={(ordered) => void reorder("documents", ordered)}
                    renderItem={(d) => docRow(d, p, editable, f)}
                    renderOverlay={(d) => docOverlay(d)}
                  />
                  {folderDocs.length === 0 && (
                    <div className="px-2 py-1 pl-7 text-xs text-muted-foreground italic">empty</div>
                  )}
                </div>
              )}
            </div>
          )}
        </SortableItem>
      );
    };

    return (
      <>
        <Reorderable
          items={projectFolders}
          strategy={verticalListSortingStrategy}
          enabled={dndOn}
          touch={isTouch}
          onReorder={(ordered) => void reorder("folders", ordered)}
          renderItem={folderItem}
          renderOverlay={(f) => folderOverlay(f)}
        />
        <Reorderable
          items={rootDocs}
          strategy={verticalListSortingStrategy}
          enabled={dndOn}
          touch={isTouch}
          onReorder={(ordered) => void reorder("documents", ordered)}
          renderItem={(d) => docRow(d, p, editable, null)}
          renderOverlay={(d) => docOverlay(d)}
        />
        {empty && (
          <div className="px-3 py-2 text-center text-xs text-muted-foreground">
            No documents yet
          </div>
        )}
      </>
    );
  };

  const projectMenu = (p: Project): MenuAction[] => [
    ...(canEdit
      ? ([
          {
            label: "New folder",
            icon: <FolderPlus />,
            onSelect: () => void actions.newFolder(p),
          },
          {
            label: "New document",
            icon: <FilePlus />,
            onSelect: () => void onCreateDoc(p, null),
          },
        ] as MenuAction[])
      : []),
    ...(canConfigure
      ? ([
          {
            label: "Rename",
            icon: <Pencil />,
            separatorBefore: canEdit,
            onSelect: () => void actions.editProject(p),
          },
          // Settings page is not part of the mobile experience.
          ...(!isMobile
            ? ([
                {
                  label: "Settings",
                  icon: <Settings />,
                  onSelect: () => navigate(projectSettingsPath(p.slug)),
                },
              ] as MenuAction[])
            : []),
          {
            label: "Delete",
            icon: <Trash2 />,
            danger: true,
            onSelect: () => void onDeleteProject(p),
          },
        ] as MenuAction[])
      : []),
  ];

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        // Mobile: fixed drawer, always w-80, slides in/out via translate.
        "max-md:w-80 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl",
        drawerOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        // Desktop: mutually exclusive width classes so Tailwind ordering never causes conflicts,
        // plus a smooth width transition on collapse/expand.
        sidebarCollapsed ? "md:w-0 md:border-r-0" : "md:w-68 xl:w-80",
        "md:transition-[width] md:duration-300 md:ease-in-out",
      )}
    >
      {/* Inner content stays put and only fades (no translate) as the aside collapses its width. The
          quicker opacity fade masks the width-clip so it reads as a clean fade-out, not a shift. */}
      <div className="flex h-full w-80 md:w-68 xl:w-80 flex-col max-md:pt-[env(safe-area-inset-top)]">
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {proj ? (
            <>
              <div className="group mb-1 flex items-center gap-1 px-1">
                <Link
                  to={projectPath(proj.slug)}
                  onClick={onCloseDrawer}
                  className={cn(
                    "flex min-w-0 flex-1 items-center rounded-md px-1.5 py-1 max-md:py-2 text-sm font-bold tracking-tight hover:bg-sidebar-accent gap-2",
                  )}
                >
                  <ProjectGlyph
                    project={proj}
                    visibility={visOf(proj)}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate text-base">
                    {proj.name}
                  </span>
                </Link>
                <ActionsMenu actions={projectMenu(proj)} />
              </div>
              {renderTree(proj, canEdit)}

              {proj.is_workspace && (
                <div className="mt-5">
                  <div className="mb-1 flex items-center gap-1 pr-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          to={notesPath(proj.slug)}
                          onClick={onCloseDrawer}
                          aria-label="All quick notes"
                          className="group flex h-7 max-md:h-10 flex-1 items-center gap-1.5 rounded-md px-1.5 hover:bg-sidebar-accent"
                        >
                          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase group-hover:text-foreground">
                            Quick notes
                          </span>
                          <ArrowRight className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>All quick notes</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => void onNewQuickNote(proj)}
                          aria-label="New quick note"
                          className="flex size-7 max-md:size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm shadow-primary/20 transition-colors hover:bg-primary/90"
                        >
                          <Plus className="size-4.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>New quick note</TooltipContent>
                    </Tooltip>
                  </div>
                  {quickNotes.length === 0 ? (
                    <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                      No quick notes yet
                    </div>
                  ) : (
                    <>
                      {quickNotes.slice(0, 4).map((n) => {
                        const active = activeNoteId === n.slug;
                        return (
                          <Link
                            key={n.id}
                            to={notePath(proj.slug, n.slug)}
                            onClick={onCloseDrawer}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors max-md:py-2.5",
                              active
                                ? "bg-primary/15 font-medium text-foreground"
                                : "text-sidebar-foreground hover:bg-sidebar-accent",
                            )}
                          >
                            <QuickNoteIcon
                              className={cn(
                                "size-3.75 shrink-0",
                                active
                                  ? "text-primary"
                                  : "text-muted-foreground",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {docLabel(n)}
                            </span>
                          </Link>
                        );
                      })}
                      {quickNotes.length > 4 && (
                        <Link
                          to={notesPath(proj.slug)}
                          onClick={onCloseDrawer}
                          className="mt-0.5 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          Show all {quickNotes.length}{" "}
                          <ArrowRight className="size-3" />
                        </Link>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {user
                ? "Select a project from the dashboard."
                : "Sign in to see your workspace."}
            </div>
          )}
        </nav>

        {user && (
          <div className="shrink-0 border-t border-sidebar-border p-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => void onCreateProject()}
            >
              <Plus /> New project
            </Button>
          </div>
        )}

        <div className="shrink-0 border-t border-sidebar-border p-2 max-md:pb-[max(8px,env(safe-area-inset-bottom))]">
          {user ? (
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5 max-md:py-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {/* Wrap with a Link so clicking the avatar closes the drawer on mobile too. */}
                <Link
                  to="/profile"
                  onClick={onCloseDrawer}
                  className="inline-flex min-w-0 flex-1 items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  <ProfileAvatar
                    userId={user.id}
                    name={user.name}
                    email={user.email}
                    avatarUrl={user.avatar_url}
                    variant="inline"
                    size="sm"
                    noLink
                  />
                </Link>
                {role === "admin" && (
                  <Badge
                    variant="destructive"
                    className="shrink-0 px-1.5 py-0 text-[10px] leading-5"
                  >
                    admin
                  </Badge>
                )}
                {role === "mod" && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 px-1.5 py-0 text-[10px] leading-5"
                  >
                    mod
                  </Badge>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 max-md:size-9 shrink-0 text-muted-foreground"
                    aria-label="Account menu"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  {!isMobile && (
                    <DropdownMenuItem
                      onSelect={() => {
                        onCloseDrawer();
                        navigate("/profile");
                      }}
                    >
                      <User /> Profile
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      toggle();
                    }}
                  >
                    {theme === "dark" ? <Sun /> : <Moon />}
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      onCloseDrawer();
                      navigate("/bug");
                    }}
                  >
                    <Bug className="text-destructive" /> Report a bug
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      onCloseDrawer();
                      navigate("/request");
                    }}
                  >
                    <Lightbulb className="text-accent2" /> Feature request
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    {/* AGPL §13: offer source to network users. */}
                    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
                      <Code2 /> Source code
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => void onSignOut()}
                  >
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => setShowLogin(true)}
              >
                Sign in
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-muted-foreground"
                onClick={toggle}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun /> : <Moon />}
              </Button>
            </div>
          )}
        </div>
      </div>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </aside>
  );
}
