import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Globe, Lock, Settings2, Trash2, UserPlus } from "lucide-react";
import {
  addMember,
  findUserByEmail,
  getProjectOwner,
  listProjectMembers,
  removeMember,
  setProjectPublic,
  setProjectPublicRole,
} from "../lib/crud";
import { useAuth } from "../context/AuthContext";
import { useTree } from "../hooks/useTree";
import { useRouteContext } from "../hooks/useRouteContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { usePermissionsDialog } from "../context/PermissionsDialogContext";
import { canConfigureProject } from "../lib/access";
import { docLabel } from "../lib/labels";
import { toast } from "../lib/toast";
import { InviteLinksManager } from "./ResourceAccess";
import { DocIcon, FolderGlyph } from "./EntityIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import QuerySuspense from "./QuerySuspense";
import ProfileAvatar from "./ProfileAvatar";
import PageLayout from "./PageLayout";
import PageHeader from "./PageHeader";
import { cn } from "@/lib/utils";
import type { MemberInfo, MemberRole } from "../lib/types";

const inviteSchema = z.object({
  email: z.email("Enter a valid email address"),
});
type InviteValues = z.infer<typeof inviteSchema>;

function RoleSelect({
  value,
  disabled,
  onChange,
  hideViewer,
  hideCommenter,
}: {
  value: MemberRole;
  disabled?: boolean;
  onChange: (r: MemberRole) => void;
  hideViewer?: boolean;
  // LaTeX projects only offer Can view / Can edit — no commenter tier (§3.4).
  hideCommenter?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => onChange(v as MemberRole)}
    >
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!hideViewer && <SelectItem value="viewer">can view</SelectItem>}
        {!hideCommenter && <SelectItem value="commenter">can comment</SelectItem>}
        <SelectItem value="editor">can edit</SelectItem>
      </SelectContent>
    </Select>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-[12vh] max-w-xl px-6 text-center">
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mb-6 text-muted-foreground">{body}</p>
      <Button variant="outline" asChild>
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}

// One folder/document row in the centralized Access panel — shows whether it's private and opens the
// per-resource access dialog (the same one used inline in the file tree).
function AccessRow({
  icon,
  name,
  isPrivate,
  onManage,
}: {
  icon: ReactNode;
  name: string;
  isPrivate: boolean;
  onManage: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {isPrivate && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" /> Private
        </span>
      )}
      <Button variant="ghost" size="sm" onClick={onManage}>
        <Settings2 className="size-4" /> Manage
      </Button>
    </div>
  );
}

export default function ProjectSettings() {
  const { project, projectSlug } = useRouteContext();
  const { role, uid } = useAuth();
  const { folders, documents, refresh, queries } = useTree();
  const permissions = usePermissionsDialog();
  // LaTeX sharing is Can view / Can edit only — no commenter tier (§3.4).
  const isLatex = project?.type === "latex";

  useDocumentTitle(project ? `${project.name} · Settings` : undefined);

  const [isPublic, setIsPublic] = useState(project?.is_public ?? false);
  const [publicRole, setPublicRole] = useState<MemberRole>(
    project?.public_role ?? "viewer",
  );
  const [members, setMembers] = useState<MemberInfo[] | null>(null);
  const [owner, setOwner] = useState<{
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [inviteRole, setInviteRole] = useState<MemberRole>("viewer");
  const [busy, setBusy] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "" },
  });

  // Sync the visibility toggle to the resolved project without an effect (adjust-during-render).
  const projectId = project?.id;
  const [trackedId, setTrackedId] = useState(projectId);
  if (trackedId !== projectId) {
    setTrackedId(projectId);
    setIsPublic(project?.is_public ?? false);
    setPublicRole(project?.public_role ?? "viewer");
  }
  useEffect(() => {
    if (projectId)
      listProjectMembers(projectId)
        .then(setMembers)
        .catch(() => setMembers([]));
  }, [projectId]);

  useEffect(() => {
    if (projectId && project?.owner) {
      getProjectOwner(projectId)
        .then(setOwner)
        .catch(() => setOwner(null));
    }
  }, [projectId, project?.owner]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      void refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  const reload = () => {
    if (projectId)
      return listProjectMembers(projectId)
        .then(setMembers)
        .catch(() => setMembers([]));
  };

  const togglePublic = () =>
    guard(async () => {
      if (!project) return;
      const next = !isPublic;
      await setProjectPublic(project.id, next);
      setIsPublic(next);
      // Public projects are already readable by anyone; the minimum meaningful explicit role is
      // commenter — but LaTeX has no commenter tier, so it bumps straight to editor.
      if (next && inviteRole === "viewer") setInviteRole(isLatex ? "editor" : "commenter");
      toast(
        "success",
        next ? "Project is now public" : "Project is now private",
      );
    });

  const onInvite = handleSubmit((values) =>
    guard(async () => {
      if (!project) return;
      const u = await findUserByEmail(values.email.trim());
      if (!u) {
        toast(
          "error",
          "No user found with that email. They need to sign up first.",
        );
        return;
      }
      await addMember(project.id, u.id, inviteRole);
      reset({ email: "" });
      await reload();
      toast("success", `Invited ${u.name || u.email}`);
    }),
  );

  const changeRole = (userId: string, r: MemberRole) =>
    guard(async () => {
      if (!project) return;
      await addMember(project.id, userId, r);
      await reload();
      toast("success", "Access updated");
    });

  const changePublicRole = (r: MemberRole) =>
    guard(async () => {
      if (!project) return;
      await setProjectPublicRole(project.id, r);
      setPublicRole(r);
      toast("success", "Default permission updated");
    });

  const remove = (userId: string) =>
    guard(async () => {
      if (!project) return;
      await removeMember(project.id, userId);
      await reload();
      toast("success", "Access removed");
    });

  return (
    <QuerySuspense queries={queries} loadingLabel="Loading settings…">
      {(() => {
        if (!project)
          return (
            <Notice
              title="Not found"
              body={`Project "${projectSlug}" doesn’t exist or you can’t access it.`}
            />
          );
        if (project.is_workspace)
          return (
            <Notice
              title="No settings"
              body="Your workspace is private to you and can’t be shared or configured."
            />
          );
        if (!canConfigureProject(project, role, uid))
          return (
            <Notice
              title="No access"
              body="Only the project owner can change these settings."
            />
          );

        const projectFolders = folders.filter((f) => f.project_id === project.id);
        const projectDocs = documents.filter(
          (d) => d.project_id === project.id && !d.is_quick_note,
        );
        return (
          <PageLayout variant="medium">
            <PageHeader
              title="Project settings"
              description={`Manage who can see and edit "${project.name}".`}
            />

            {owner && (
              <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold">Owner</h2>
                <div className="flex items-center rounded-xl border border-border bg-card px-4 py-3">
                  <ProfileAvatar
                    userId={owner.id}
                    name={owner.name}
                    email={owner.email}
                    avatarUrl={owner.avatar_url}
                    variant="inline"
                    size="md"
                  />
                </div>
              </section>
            )}

            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold">General access</h2>
              <div
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-4 transition-colors",
                  isPublic ? "border-primary/50 bg-primary/5" : "border-border",
                )}
              >
                <span
                  className={cn(
                    isPublic ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {isPublic ? (
                    <Globe className="size-5" />
                  ) : (
                    <Lock className="size-5" />
                  )}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">
                    {isPublic
                      ? "Public"
                      : members && members.length
                        ? "Shared"
                        : "Private"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {isPublic
                      ? "Anyone, including logged-out visitors, can view."
                      : "Only you, staff, and invited people."}
                  </div>
                </div>
                <Switch
                  checked={isPublic}
                  disabled={busy}
                  onCheckedChange={() => void togglePublic()}
                />
              </div>

              {isPublic && (
                <div className="mt-3 rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        Default permission
                      </div>
                      <div className="text-xs text-muted-foreground">
                        What everyone with access can do — no invite needed.
                      </div>
                    </div>
                    <RoleSelect
                      value={publicRole}
                      disabled={busy}
                      onChange={(r) => void changePublicRole(r)}
                      hideCommenter={isLatex}
                    />
                  </div>
                  {publicRole === "editor" && (
                    <p className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      <AlertTriangle className="size-4 shrink-0" />
                      Anyone who can open this project can edit its content
                      directly, without your approval.
                    </p>
                  )}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold">Invite people</h2>
              <form
                className="flex flex-col gap-2"
                onSubmit={onInvite}
                noValidate
              >
                <div className="flex flex-col gap-1.5">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    aria-invalid={!!errors.email}
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <RoleSelect
                    value={inviteRole}
                    onChange={setInviteRole}
                    hideViewer={isPublic}
                    hideCommenter={isLatex}
                  />
                  <Button
                    type="submit"
                    disabled={busy}
                    className="flex-1 md:flex-none"
                  >
                    <UserPlus /> Add
                  </Button>
                </div>
              </form>

              <div className="mt-3 overflow-hidden rounded-xl border border-border">
                {!members && (
                  <div className="p-3 text-center text-sm text-muted-foreground">
                    Loading…
                  </div>
                )}
                {members && members.length === 0 && (
                  <div className="p-3 text-center text-sm text-muted-foreground">
                    No one invited yet.
                  </div>
                )}
                {members?.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0"
                  >
                    <ProfileAvatar
                      userId={m.user_id}
                      name={m.name}
                      email={m.email}
                      avatarUrl={null}
                      variant="inline"
                      size="sm"
                      className="min-w-0 flex-1"
                    />
                    <RoleSelect
                      value={m.role}
                      disabled={busy}
                      onChange={(r) => void changeRole(m.user_id, r)}
                      hideViewer={isPublic}
                      hideCommenter={isLatex}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Remove"
                          disabled={busy}
                          onClick={() => void remove(m.user_id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Or share a link
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Anyone who signs in and opens the link joins the project with the access you pick.
                </p>
                <InviteLinksManager project={project} hideCommenter={isLatex} />
              </div>
            </section>

            {/* Centralized per-resource access — markdown only (LaTeX has no per-file access control). */}
            {!isLatex && (
              <section className="mt-8">
                <h2 className="mb-1 text-sm font-semibold">Private folders &amp; documents</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Make any folder or document private, then choose exactly who can access it — independent
                  of who can see the rest of the project.
                </p>
                {projectFolders.length === 0 && projectDocs.length === 0 ? (
                  <p className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
                    This project has no folders or documents yet.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    {projectFolders.map((f) => (
                      <AccessRow
                        key={f.id}
                        icon={<FolderGlyph className="size-4 text-muted-foreground" />}
                        name={f.name}
                        isPrivate={f.is_private}
                        onManage={() =>
                          permissions.open({
                            kind: "folder",
                            id: f.id,
                            name: f.name,
                            projectId: project.id,
                            accessOverride: f.access_override,
                            isPrivate: f.is_private,
                          })
                        }
                      />
                    ))}
                    {projectDocs.map((d) => (
                      <AccessRow
                        key={d.id}
                        icon={<DocIcon className="size-4 text-muted-foreground" />}
                        name={docLabel(d)}
                        isPrivate={d.is_private}
                        onManage={() =>
                          permissions.open({
                            kind: "document",
                            id: d.id,
                            name: docLabel(d),
                            projectId: project.id,
                            accessOverride: d.access_override,
                            isPrivate: d.is_private,
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </PageLayout>
        );
      })()}
    </QuerySuspense>
  );
}
