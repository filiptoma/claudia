import type { ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowUpDown,
  Check,
  FilePlus,
  FlaskConical,
  FolderPlus,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useIsTouch } from "../hooks/useIsTouch";
import { useReorderMode } from "../lib/reorderMode";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { treeKeys, useTree } from "../hooks/useTree";
import { useTreeActions } from "../hooks/useTreeActions";
import { useRouteContext } from "../hooks/useRouteContext";
import { useQuickNotes } from "../hooks/useQuickNotes";
import {
  canCommentDocument,
  canConfigureProject,
  canEditDocument,
  canEditFolder,
  canEditProject,
  documentGrantRole,
  folderGrantRole,
  projectVisibility,
} from "../lib/access";
import {
  docSplitPath,
  folderPath,
  notesPath,
  noteSplitPath,
  projectPath,
  projectSettingsPath,
} from "../lib/paths";
import { docLabel, formatDateTime } from "../lib/labels";
import Breadcrumbs from "./Breadcrumbs";
import type { Crumb } from "./Breadcrumbs";
import ActionsMenu from "./ActionsMenu";
import type { MenuAction } from "./ActionsMenu";
import CreateMenu from "./CreateMenu";
import ExportMenuItems from "./ExportMenuItems";
import { readLiveDoc } from "../lib/liveDoc";
import type { DocumentRec } from "../lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebar } from "../context/SidebarContext";
import { APP_NAME } from "../lib/brand";
import astroLogoBlack from "../assets/astro-black.svg";
import astroLogoWhite from "../assets/astro-white.svg";
import ModeSwitch from "./ModeSwitch";
import type { Mode } from "./ModeSwitch";
import { availableModesFor, resolveMode } from "../lib/docMode";
import SaveIndicator from "./SaveIndicator";
import PresenceAvatars from "./PresenceAvatars";
import {
  DocIcon,
  FolderGlyph,
  ProjectGlyph,
  QuickNoteIcon,
} from "./EntityIcons";

const ICON_CLS = "size-4 shrink-0 text-muted-foreground";

export default function AppHeader() {
  const { project, folder, doc, projectSlug } = useRouteContext();
  const location = useLocation();
  const navigate = useNavigate();
  const { role, uid } = useAuth();
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  const reorderActive = useReorderMode((s) => s.active);
  const toggleReorder = useReorderMode((s) => s.toggle);
  const { members, folders, grants } = useTree();
  const actions = useTreeActions();
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useParams();
  const { workspace, notes, findNote } = useQuickNotes();
  const qc = useQueryClient();

  // Source for the app-bar Export menu (markdown docs + quick notes): the live editor content when its
  // editor is mounted, else the saved content from the query cache (null while it's still loading).
  const exportContent = (id: string): string | null =>
    readLiveDoc(id) ??
    qc.getQueryData<DocumentRec>(treeKeys.document(id))?.content ??
    null;

  const memberCount = useMemo(
    () =>
      project ? members.filter((m) => m.project_id === project.id).length : 0,
    [members, project],
  );

  // The URL's ?mode= is the single source of truth; the resolved mode (defaulting to "view") is
  // computed per-branch from what the user can do — see resolveMode/availableModesFor. setMode writes
  // it back so the selection sticks.
  const urlMode = searchParams.get("mode");
  const setMode = (m: Mode) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("mode", m);
        return next;
      },
      { replace: true },
    );
  };

  // ----- quick notes (/:workspace/notes, /:workspace/notes/:id) -----
  // No folder/doc slug is ever exactly "notes" (they carry nanoids), so this segment is unambiguous.
  if (location.pathname.split("/")[2] === "notes") {
    const wsSlug = workspace?.slug ?? location.pathname.split("/")[1];
    const workspaceCrumb: Crumb = workspace
      ? {
          label: workspace.name,
          to: projectPath(workspace.slug),
          icon: (
            <ProjectGlyph
              project={workspace}
              visibility="private"
              className={ICON_CLS}
            />
          ),
        }
      : { label: wsSlug };
    const notesCrumb = (last: boolean): Crumb => ({
      label: "Quick notes",
      to: last ? undefined : notesPath(wsSlug),
      icon: <QuickNoteIcon className={ICON_CLS} />,
    });

    const noteId = params.id;
    if (noteId) {
      const note = findNote(noteId);
      if (!note) {
        return (
          <HeaderShell
            items={[workspaceCrumb, notesCrumb(false), { label: "Not found" }]}
          />
        );
      }
      const items: Crumb[] = [
        workspaceCrumb,
        notesCrumb(false),
        {
          label: docLabel(note),
          icon: <QuickNoteIcon className={ICON_CLS} />,
          editable: {
            id: note.id,
            value: note.title,
            placeholder: formatDateTime(note.created_at),
            onSubmit: (v) => void actions.submitDocTitle(note, v),
          },
        },
      ];
      const menu: MenuAction[] = [
        {
          label: "Rename",
          icon: <Pencil />,
          onSelect: () => void actions.editDocument(note),
        },
        {
          label: "Delete",
          icon: <Trash2 />,
          danger: true,
          onSelect: async () => {
            if (await actions.deleteDocument(note)) navigate(notesPath(wsSlug));
          },
        },
      ];
      // Quick notes live in the owner-only workspace, so the viewer is always an editor.
      const noteModes = availableModesFor(true, false, isMobile);
      const noteMode = resolveMode(urlMode, noteModes);
      return (
        <HeaderShell
          items={items}
          actions={
            <>
              <SaveIndicator />
              <ModeSwitch
                mode={noteMode}
                onChange={setMode}
                availableModes={noteModes}
              />
              <ActionsMenu alwaysVisible label="Note actions" actions={menu}>
                <ExportMenuItems
                  getContent={() => exportContent(note.id)}
                  title={docLabel(note)}
                />
              </ActionsMenu>
            </>
          }
        />
      );
    }
    // notes list
    const onNew = async () => {
      const note = await actions.newQuickNote();
      if (note) navigate(noteSplitPath(wsSlug, note.slug));
    };
    return (
      <HeaderShell
        items={[workspaceCrumb, notesCrumb(true)]}
        actions={
          workspace && notes.length > 0 ? (
            <CreateMenu
              variant="accent"
              compact={isMobile}
              actions={[
                {
                  label: "New quick note",
                  icon: <Plus />,
                  onSelect: () => void onNew(),
                },
              ]}
            />
          ) : null
        }
      />
    );
  }

  // ----- top-level (non-project) pages -----
  if (!projectSlug) {
    // Logged-out visitors see the public landing ("Home"); signed-in users get their "Dashboard".
    let items: Crumb[] = [{ label: uid ? "Dashboard" : "Home" }];
    if (location.pathname === "/profile") items = [{ label: "Profile" }];
    else if (location.pathname.startsWith("/users/"))
      items = [{ label: "Public profile" }];
    else if (location.pathname === "/explore")
      items = [{ label: "Public projects" }];
    else if (location.pathname === "/bug") items = [{ label: "Report a bug" }];
    else if (location.pathname === "/request")
      items = [{ label: "Feature request" }];
    else if (location.pathname === "/admin") items = [{ label: "Admin" }];
    else if (location.pathname === "/admin/users")
      items = [{ label: "Admin", to: "/admin" }, { label: "Users" }];
    else if (location.pathname === "/admin/projects")
      items = [{ label: "Admin", to: "/admin" }, { label: "All projects" }];
    else if (location.pathname === "/admin/feedback")
      items = [{ label: "Admin", to: "/admin" }, { label: "Feedback" }];
    return <HeaderShell items={items} />;
  }

  if (!project) {
    return <HeaderShell items={[{ label: projectSlug }]} />;
  }

  const myMemberRole = members.find(
    (m) => m.project_id === project.id && m.user_id === uid,
  )?.role;
  const canEdit = canEditProject(project, role, uid, myMemberRole);
  const canConfigure = canConfigureProject(project, role, uid);
  // Touch-only "Change order" toggle for the ⋯ on project/folder pages: flips the global reorder mode
  // that turns cards/sidebar rows into drag handles. Non-touch devices reorder by dragging directly, so
  // they never see it. `gate` is the relevant edit permission (the folder's, or the project's).
  const reorderItems = (gate: boolean): MenuAction[] =>
    isTouch && gate
      ? [
          {
            label: reorderActive ? "Done reordering" : "Change order",
            icon: reorderActive ? <Check /> : <ArrowUpDown />,
            onSelect: () => toggleReorder(),
          },
        ]
      : [];
  const isSettings = location.pathname === projectSettingsPath(project.slug);
  const visibility = projectVisibility(project, memberCount);

  // The project crumb keeps its icon (workspace glyph or visibility) in every view. LaTeX projects
  // carry a "Beta" badge so the in-browser-compile feature is flagged as experimental everywhere.
  const isLatexProject = project.type === "latex";
  const projectCrumb: Crumb = {
    label: project.name,
    to: projectPath(project.slug),
    icon: (
      <ProjectGlyph
        project={project}
        visibility={visibility}
        className={ICON_CLS}
      />
    ),
    accessory: isLatexProject ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="notice"
            className="ml-0.5 cursor-default gap-1 font-semibold no-underline"
          >
            <FlaskConical />
            Beta
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          LaTeX projects are a beta feature, expect bugs
        </TooltipContent>
      </Tooltip>
    ) : undefined,
  };

  // ----- /:project/settings -----
  if (isSettings) {
    return <HeaderShell items={[projectCrumb, { label: "Settings" }]} />;
  }

  // ----- document view -----
  if (doc) {
    // Gate this view on the DOCUMENT'S effective permissions (folds in the document + parent-folder
    // caps), so a doc the owner locked to "view only" hides edit/comment affordances from everyone else.
    // LaTeX is project-level only — edit = project edit, no commenter tier (§3.4), so docModes resolves
    // to [view, split, edit] for editors and [view] for viewers, with no comment affordances.
    const isLatex = isLatexProject;
    const docGrant = documentGrantRole(grants, doc, uid);
    const docCanEdit = isLatex
      ? canEditProject(project, role, uid, myMemberRole)
      : canEditDocument(project, doc, folder, role, uid, myMemberRole, docGrant);
    const docCanComment = isLatex
      ? false
      : canCommentDocument(project, doc, folder, role, uid, myMemberRole, docGrant);
    // Mode comes from the URL, clamped to what this user/device allows. When the URL omits it, LaTeX
    // lands editors in split and viewers in view (§3.x); markdown keeps the universal "view" default.
    const docModes = availableModesFor(docCanEdit, docCanComment, isMobile);
    const docMode = resolveMode(
      urlMode,
      docModes,
      isLatex && docCanEdit ? "split" : "view",
    );
    const items: Crumb[] = [projectCrumb];
    if (folder)
      items.push({
        label: folder.name,
        to: folderPath(project.slug, folder.slug),
        icon: <FolderGlyph className={ICON_CLS} />,
      });
    items.push({
      label: docLabel(doc),
      icon: <DocIcon className={ICON_CLS} />,
      editable: docCanEdit
        ? {
            id: doc.id,
            value: doc.title,
            placeholder: "Untitled note",
            onSubmit: (v) => void actions.submitDocTitle(doc, v),
          }
        : undefined,
    });
    // The app-bar ⋯ is the document's full action menu: rename, project settings (managers), export,
    // and a destructive Delete pinned last. Permission management still lives only on the settings page.
    const onDeleteDoc = async () => {
      if (await actions.deleteDocument(doc))
        navigate(folder ? folderPath(project.slug, folder.slug) : projectPath(project.slug));
    };
    const menu: MenuAction[] = [
      ...(docCanEdit
        ? [
            {
              label: "Rename",
              icon: <Pencil />,
              onSelect: () => void actions.editDocument(doc),
            } satisfies MenuAction,
          ]
        : []),
      ...(canConfigure
        ? [
            {
              label: "Project settings",
              icon: <Settings />,
              separatorBefore: docCanEdit,
              onSelect: () => navigate(projectSettingsPath(project.slug)),
            } satisfies MenuAction,
          ]
        : []),
    ];
    // Export (markdown only — LaTeX compiles its own PDF) and Delete render after the actions above as
    // menu children, so the destructive Delete always sits last.
    const exportItems = isLatex ? null : (
      <ExportMenuItems
        getContent={() => exportContent(doc.id)}
        title={docLabel(doc)}
        leadingSeparator={menu.length > 0}
      />
    );
    const deleteItem = docCanEdit ? (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void onDeleteDoc()}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </>
    ) : null;
    // "Who else has this open" — signed-in viewers only (logged-out visitors never appear/observe).
    // Shown for editors, commenters and viewers alike; renders nothing when you're alone on the doc.
    const presence = uid ? <PresenceAvatars /> : null;
    return (
      <HeaderShell
        items={items}
        actions={
          presence || docCanEdit || docCanComment || exportItems ? (
            <>
              {presence}
              {docCanEdit ? (
                <>
                  <SaveIndicator />
                  <ModeSwitch
                    mode={docMode}
                    onChange={setMode}
                    availableModes={docModes}
                  />
                  {(menu.length > 0 || exportItems || deleteItem) && (
                    <ActionsMenu
                      alwaysVisible
                      label="Document actions"
                      actions={menu}
                    >
                      {exportItems}
                      {deleteItem}
                    </ActionsMenu>
                  )}
                </>
              ) : (
                <>
                  {docCanComment && (
                    // Commenters suggest edits via split (desktop) or, since split is unavailable on
                    // mobile, via edit mode (suggestion mode) on mobile.
                    <ModeSwitch
                      mode={docMode}
                      onChange={setMode}
                      availableModes={docModes}
                    />
                  )}
                  {(menu.length > 0 || exportItems || deleteItem) && (
                    <ActionsMenu
                      alwaysVisible
                      label="Document actions"
                      actions={menu}
                    >
                      {exportItems}
                      {deleteItem}
                    </ActionsMenu>
                  )}
                </>
              )}
            </>
          ) : null
        }
      />
    );
  }

  // ----- folder view -----
  if (folder) {
    // Fold the folder's own cap into its edit gate, so a locked folder hides its edit affordances.
    const folderCanEdit = canEditFolder(
      project,
      folder,
      role,
      uid,
      myMemberRole,
      folderGrantRole(grants, folder.id, uid),
    );
    const items: Crumb[] = [
      projectCrumb,
      {
        label: folder.name,
        icon: <FolderGlyph className={ICON_CLS} />,
        editable: folderCanEdit
          ? {
              id: folder.id,
              value: folder.name,
              onSubmit: (v) => void actions.submitFolderName(folder, v),
            }
          : undefined,
      },
    ];
    // The app-bar ⋯ is the folder's full action menu: new document, rename, project settings
    // (managers), and a destructive Delete pinned last. (Rename is also available from the title.)
    const onDeleteFolder = async () => {
      if (await actions.deleteFolder(folder)) navigate(projectPath(project.slug));
    };
    const menu: MenuAction[] = [
      ...reorderItems(folderCanEdit),
      ...(folderCanEdit
        ? [
            {
              label: "New document",
              icon: <FilePlus />,
              onSelect: async () => {
                const d = await actions.newDocument(project, folder.id);
                if (d) navigate(docSplitPath(project.slug, d, folders));
              },
            } satisfies MenuAction,
            {
              label: "Rename",
              icon: <Pencil />,
              onSelect: () => void actions.editFolder(folder),
            } satisfies MenuAction,
          ]
        : []),
      ...(canConfigure
        ? [
            {
              label: "Project settings",
              icon: <Settings />,
              separatorBefore: folderCanEdit,
              onSelect: () => navigate(projectSettingsPath(project.slug)),
            } satisfies MenuAction,
          ]
        : []),
      ...(folderCanEdit
        ? [
            {
              label: "Delete",
              icon: <Trash2 />,
              danger: true,
              separatorBefore: true,
              onSelect: () => void onDeleteFolder(),
            } satisfies MenuAction,
          ]
        : []),
    ];
    return (
      <HeaderShell
        items={items}
        actions={
          menu.length > 0 ? (
            <ActionsMenu alwaysVisible label="Folder actions" actions={menu} />
          ) : null
        }
      />
    );
  }

  // ----- project root view -----
  // The app-bar ⋯ is the project's full action menu: create (document/folder, plus quick note in the
  // workspace), rename + settings (managers), and a destructive Delete pinned last. The page body still
  // shows its own prominent CTA while the project is empty; this menu is the persistent action hub.
  const onDeleteProject = async () => {
    if (await actions.deleteProject(project)) navigate("/");
  };
  const goNewDoc = async () => {
    const d = await actions.newDocument(project, null);
    if (d) navigate(docSplitPath(project.slug, d, folders));
  };
  const menu: MenuAction[] = [
    ...reorderItems(canEdit),
    ...(canEdit
      ? [
          ...(project.is_workspace
            ? [
                {
                  label: "New quick note",
                  icon: <StickyNote className="text-accent2" />,
                  onSelect: async () => {
                    const n = await actions.newQuickNote();
                    if (n) navigate(noteSplitPath(project.slug, n.slug));
                  },
                } satisfies MenuAction,
              ]
            : []),
          {
            label: "New document",
            icon: <FilePlus />,
            onSelect: () => void goNewDoc(),
          } satisfies MenuAction,
          {
            label: "New folder",
            icon: <FolderPlus />,
            onSelect: () => void actions.newFolder(project),
          } satisfies MenuAction,
        ]
      : []),
    ...(canConfigure
      ? [
          {
            label: "Rename",
            icon: <Pencil />,
            separatorBefore: canEdit,
            onSelect: () => void actions.editProject(project),
          } satisfies MenuAction,
          {
            label: "Project settings",
            icon: <Settings />,
            onSelect: () => navigate(projectSettingsPath(project.slug)),
          } satisfies MenuAction,
          {
            label: "Delete",
            icon: <Trash2 />,
            danger: true,
            separatorBefore: true,
            onSelect: () => void onDeleteProject(),
          } satisfies MenuAction,
        ]
      : []),
  ];

  return (
    <HeaderShell
      items={[projectCrumb]}
      actions={
        menu.length > 0 ? (
          <ActionsMenu alwaysVisible label="Project actions" actions={menu} />
        ) : null
      }
    />
  );
}

function HeaderShell({
  items,
  actions,
}: {
  items: Crumb[];
  actions?: ReactNode;
}) {
  const { collapsed, toggle, openMobile } = useSidebar();
  return (
    <header className="flex h-[calc(3.25rem+env(safe-area-inset-top))] shrink-0 items-center border-b border-border bg-background/80 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-sm md:px-3">
      {/* Brand zone: logo. Always visible regardless of sidebar state. On mobile the app name text
          is hidden so we pull in the padding significantly to reclaim horizontal space. */}
      <Link
        to="/"
        aria-label={APP_NAME}
        className="flex items-center gap-2 text-base font-bold tracking-tight border-r h-13 pl-1.5 pr-2 border-border md:pl-2 md:pr-6"
      >
        <img
          src={astroLogoBlack}
          alt=""
          aria-hidden
          className="size-7 dark:hidden"
        />
        <img
          src={astroLogoWhite}
          alt=""
          aria-hidden
          className="hidden size-7 dark:block"
        />
        <span className="max-md:hidden">{APP_NAME}</span>
      </Link>
      <div className="border-r border-border h-13 flex items-center justify-center px-1">
        {/* Desktop: collapse/expand sidebar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={collapsed ? "Show sidebar" : "Collapse sidebar"}
              className="hidden size-8 text-muted-foreground md:flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4.5" />
              ) : (
                <PanelLeftClose className="size-4.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {collapsed ? "Show sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>
        {/* Mobile: open sidebar drawer */}
        <Button
          variant="ghost"
          size="icon"
          onClick={openMobile}
          aria-label="Open navigation"
          className="flex size-8 text-muted-foreground md:hidden"
        >
          <Menu className="size-4.5" />
        </Button>
      </div>
      <div className="flex min-w-0 flex-1 items-center pl-2 pr-1 lg:pr-2 md:pl-3">
        <Breadcrumbs items={items} />
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1.5 max-md:gap-1">
          {actions}
        </div>
      )}
    </header>
  );
}
