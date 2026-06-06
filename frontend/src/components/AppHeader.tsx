import type { ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  FilePlus,
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
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { useTree } from "../hooks/useTree";
import { useTreeActions } from "../hooks/useTreeActions";
import { useRouteContext } from "../hooks/useRouteContext";
import { useQuickNotes } from "../hooks/useQuickNotes";
import {
  canConfigureProject,
  canEditProject,
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
import { Button } from "@/components/ui/button";
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
import SaveIndicator from "./SaveIndicator";
import ProfileAvatar from "./ProfileAvatar";
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
  const { members, folders, documents } = useTree();
  const actions = useTreeActions();
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useParams();
  const { workspace, notes, findNote } = useQuickNotes();

  const memberCount = useMemo(
    () =>
      project ? members.filter((m) => m.project_id === project.id).length : 0,
    [members, project],
  );

  // Fetch the owner's public profile for public projects (shown as avatar on the right of the header).
  const ownerQuery = useQuery({
    queryKey: ["public-profile", project?.owner ?? null],
    enabled: !!(project?.is_public && !project.is_workspace && project.owner),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!project?.owner) return null;
      const { data } = await supabase.rpc("get_public_profile", {
        p_user: project.owner,
      });
      return (
        (
          data as
            | { id: string; name: string | null; avatar_url: string | null }[]
            | null
        )?.[0] ?? null
      );
    },
  });

  // Owner avatar shown in the header for public projects — hidden on mobile to save space.
  const ownerAvatar =
    !isMobile && project?.is_public && !project.is_workspace && project.owner ? (
      <ProfileAvatar
        userId={project.owner}
        name={ownerQuery.data?.name ?? null}
        email={null}
        avatarUrl={ownerQuery.data?.avatar_url ?? null}
        isLoading={ownerQuery.isPending}
        variant="inline"
        size="sm"
      />
    ) : null;

  // Desktop defaults to split; mobile mirrors DocumentBody: view for regular docs, edit for quick
  // notes. An explicit ?mode= param always wins. We write it back on change so the selection sticks.
  const urlMode = searchParams.get("mode") as Mode | null;
  const mobileModeDefault: Mode = doc?.is_quick_note ? "edit" : "view";
  const mode: Mode = urlMode ?? (isMobile ? mobileModeDefault : "split");
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
      return (
        <HeaderShell
          items={items}
          actions={
            <>
              <SaveIndicator />
              <ModeSwitch mode={mode} onChange={setMode} />
              <ActionsMenu alwaysVisible label="Note actions" actions={menu} />
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
    else if (location.pathname.startsWith("/users/")) items = [{ label: "Public profile" }];
    else if (location.pathname === "/explore") items = [{ label: "Public projects" }];
    else if (location.pathname === "/bug") items = [{ label: "Report a bug" }];
    else if (location.pathname === "/request") items = [{ label: "Feature request" }];
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
  const isSettings = location.pathname === projectSettingsPath(project.slug);
  const visibility = projectVisibility(project, memberCount);

  // The project crumb keeps its icon (workspace glyph or visibility) in every view.
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
  };

  // ----- /:project/settings -----
  if (isSettings) {
    return (
      <HeaderShell
        items={[projectCrumb, { label: "Settings" }]}
        actions={ownerAvatar}
      />
    );
  }

  // ----- document view -----
  if (doc) {
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
      editable: canEdit
        ? {
            id: doc.id,
            value: doc.title,
            placeholder: "Untitled note",
            onSubmit: (v) => void actions.submitDocTitle(doc, v),
          }
        : undefined,
    });
    const menu: MenuAction[] = [
      {
        label: "Rename",
        icon: <Pencil />,
        onSelect: () => void actions.editDocument(doc),
      },
      {
        label: "Delete",
        icon: <Trash2 />,
        danger: true,
        onSelect: async () => {
          if (await actions.deleteDocument(doc))
            navigate(
              folder
                ? folderPath(project.slug, folder.slug)
                : projectPath(project.slug),
            );
        },
      },
    ];
    return (
      <HeaderShell
        items={items}
        actions={
          (canEdit || ownerAvatar) ? (
            <>
              {canEdit && (
                <>
                  <SaveIndicator />
                  {ownerAvatar}
                  <ModeSwitch mode={mode} onChange={setMode} />
                  <ActionsMenu
                    alwaysVisible
                    label="Document actions"
                    actions={menu}
                  />
                </>
              )}
              {!canEdit && ownerAvatar}
            </>
          ) : null
        }
      />
    );
  }

  // ----- folder view -----
  if (folder) {
    const items: Crumb[] = [
      projectCrumb,
      {
        label: folder.name,
        icon: <FolderGlyph className={ICON_CLS} />,
        editable: canEdit
          ? {
              id: folder.id,
              value: folder.name,
              onSubmit: (v) => void actions.submitFolderName(folder, v),
            }
          : undefined,
      },
    ];
    const menu: MenuAction[] = [
      {
        label: "Rename folder",
        icon: <Pencil />,
        onSelect: () => void actions.editFolder(folder),
      },
      {
        label: "Delete folder",
        icon: <Trash2 />,
        danger: true,
        onSelect: async () => {
          if (await actions.deleteFolder(folder))
            navigate(projectPath(project.slug));
        },
      },
    ];
    const folderEmpty = !documents.some((d) => d.folder_id === folder.id);
    return (
      <HeaderShell
        items={items}
        actions={
          (canEdit || ownerAvatar) ? (
            <>
              {canEdit && (
                <>
                  {!folderEmpty && (
                    <CreateMenu
                      compact={isMobile}
                      actions={[
                        {
                          label: "New document",
                          icon: <FilePlus />,
                          onSelect: async () => {
                            const d = await actions.newDocument(project, folder.id);
                            if (d) navigate(docSplitPath(project.slug, d, folders));
                          },
                        },
                      ]}
                    />
                  )}
                  {ownerAvatar}
                  <ActionsMenu
                    alwaysVisible
                    label="Folder actions"
                    actions={menu}
                  />
                </>
              )}
              {!canEdit && ownerAvatar}
            </>
          ) : null
        }
      />
    );
  }

  // ----- project root view -----
  const overflow: MenuAction[] = canConfigure
    ? [
        {
          label: "Rename project",
          icon: <Pencil />,
          onSelect: () => void actions.editProject(project),
        },
        {
          label: "Settings",
          icon: <Settings />,
          onSelect: () => navigate(projectSettingsPath(project.slug)),
        },
        {
          label: "Delete project",
          icon: <Trash2 />,
          danger: true,
          onSelect: async () => {
            if (await actions.deleteProject(project)) navigate("/");
          },
        },
      ]
    : [];

  // The page body owns the create CTA while a project is empty (one clear call to action), so the
  // header only carries "New" once there's content. Emptiness mirrors ProjectHome exactly.
  const rootDocs = documents.filter(
    (d) => d.project_id === project.id && !d.folder_id && !d.is_quick_note,
  );
  const hasFolders = folders.some((f) => f.project_id === project.id);
  const projectEmpty =
    !hasFolders &&
    rootDocs.length === 0 &&
    (!project.is_workspace || notes.length === 0);

  const goNewDoc = async () => {
    const d = await actions.newDocument(project, null);
    if (d) navigate(docSplitPath(project.slug, d, folders));
  };
  const createActions: MenuAction[] = project.is_workspace
    ? [
        {
          label: "Quick note",
          icon: <StickyNote className="text-accent2" />,
          onSelect: async () => {
            const n = await actions.newQuickNote();
            if (n) navigate(noteSplitPath(project.slug, n.slug));
          },
        },
        {
          label: "Document",
          icon: <FilePlus />,
          onSelect: () => void goNewDoc(),
        },
        {
          label: "Folder",
          icon: <FolderPlus />,
          onSelect: () => void actions.newFolder(project),
        },
      ]
    : [
        {
          label: "Document",
          icon: <FilePlus />,
          onSelect: () => void goNewDoc(),
        },
        {
          label: "Folder",
          icon: <FolderPlus />,
          onSelect: () => void actions.newFolder(project),
        },
      ];

  return (
    <HeaderShell
      items={[projectCrumb]}
      actions={
        (canEdit || ownerAvatar) ? (
          <>
            {canEdit && (
              <>
                {!projectEmpty && <CreateMenu actions={createActions} compact={isMobile} />}
                {ownerAvatar}
                <ActionsMenu
                  alwaysVisible
                  label="Project actions"
                  actions={overflow}
                />
              </>
            )}
            {!canEdit && ownerAvatar}
          </>
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
    <header className="flex h-13 shrink-0 items-center border-b border-border bg-background/80 px-2 backdrop-blur-sm md:px-3">
      {/* Brand zone: logo. Always visible regardless of sidebar state. On mobile the app name text
          is hidden so we pull in the padding significantly to reclaim horizontal space. */}
      <Link
        to="/"
        aria-label={APP_NAME}
        className="flex items-center gap-2 text-base font-bold tracking-tight border-r h-full pl-1.5 pr-2 border-border md:pl-2 md:pr-6"
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
        <div className="flex shrink-0 items-center gap-1.5 max-md:gap-1">{actions}</div>
      )}
    </header>
  );
}
