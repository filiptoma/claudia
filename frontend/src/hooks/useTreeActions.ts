import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { treeKeys, useTree } from "./useTree";
import type { DocMeta } from "./useTree";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { toast } from "../lib/toast";
import { formatDateTime } from "../lib/labels";
import {
  createDocument,
  createFolder,
  createMainTexDocument,
  createProject,
  createQuickNote,
  removeRecord,
  renameDocument,
  renameFolder,
  renameProject,
  setMainDocument,
} from "../lib/crud";
import type { DocumentRec, Folder, Project, ProjectType } from "../lib/types";

const fail = (e: unknown) =>
  toast("error", e instanceof Error ? e.message : "Action failed");

/**
 * Shared CRUD handlers (prompt/confirm dialog → Supabase write → tree refresh → toast), used by the
 * header, sidebar, project/folder home, and document toolbar so behavior stays identical. Create
 * handlers return the new record (or null if cancelled); delete handlers return whether it happened.
 * Navigation is left to the caller.
 */
export function useTreeActions() {
  const { projects, folders, documents, refresh } = useTree();
  const { uid } = useAuth();
  const dialog = useDialog();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  // When a rename changes a slug, keep the URL in sync if it points at the renamed entity (so the
  // current page doesn't 404 on the now-stale slug). Path segments: [_, project, folder, ...].
  const syncSlugInUrl = (index: number, oldSlug: string, newSlug: string) => {
    if (oldSlug === newSlug) return;
    const segs = location.pathname.split("/");
    if (segs[index] !== oldSlug) return;
    segs[index] = newSlug;
    navigate(segs.join("/") + location.search, { replace: true });
  };
  const syncFolderSlugInUrl = (f: Folder, newSlug: string) => {
    if (f.slug === newSlug) return;
    const projectSlug = projects.find((p) => p.id === f.project_id)?.slug;
    const segs = location.pathname.split("/");
    if (!projectSlug || segs[1] !== projectSlug || segs[2] !== f.slug) return;
    segs[2] = newSlug;
    navigate(segs.join("/") + location.search, { replace: true });
  };

  // Returns the new project and, for LaTeX projects, its seeded main.tex (so the caller can open it
  // straight into split mode). Markdown projects return mainDoc=null (caller opens the project root).
  async function newProject(): Promise<{
    project: Project;
    mainDoc: DocumentRec | null;
  } | null> {
    try {
      const res = await dialog.promptWithChoice({
        title: "New project",
        label: "Project name",
        placeholder: "e.g. Algorithms",
        confirmText: "Create",
        choiceLabel: "Type",
        choiceDefault: "markdown",
        choices: [
          { value: "markdown", label: "Markdown" },
          { value: "latex", label: "LaTeX" },
        ],
        choiceNotices: {
          latex:
            "LaTeX projects are a beta feature. Some packages and edge cases aren’t supported yet.",
        },
      });
      if (!res || !uid) return null;
      const { value: name, choice } = res;
      const type = choice as ProjectType;
      const project = await createProject(name, uid, type);
      let mainDoc: DocumentRec | null = null;
      if (type === "latex") {
        mainDoc = await createMainTexDocument(project.id);
        await setMainDocument(project.id, mainDoc.id);
      }
      await refresh();
      toast("success", `Project “${project.name}” created`);
      return { project, mainDoc };
    } catch (e) {
      fail(e);
      return null;
    }
  }

  async function editProject(p: Project): Promise<void> {
    try {
      const name = await dialog.prompt({
        title: "Rename project",
        label: "Name",
        defaultValue: p.name,
        confirmText: "Rename",
      });
      if (name && name !== p.name) {
        const newSlug = await renameProject(p, name);
        await refresh();
        syncSlugInUrl(1, p.slug, newSlug);
        toast("success", "Project renamed");
      }
    } catch (e) {
      fail(e);
    }
  }

  async function deleteProject(p: Project): Promise<boolean> {
    try {
      const fcount = folders.filter((f) => f.project_id === p.id).length;
      const dcount = documents.filter((d) => d.project_id === p.id).length;
      const ok = await dialog.confirm({
        title: "Delete project",
        message: `Delete “${p.name}” and its ${fcount} folder(s) and ${dcount} document(s)? This cannot be undone.`,
        confirmText: "Delete",
        danger: true,
      });
      if (!ok) return false;
      await removeRecord("projects", p.id);
      await refresh();
      toast("success", `Project “${p.name}” deleted`);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function newFolder(p: Project): Promise<Folder | null> {
    try {
      const name = await dialog.prompt({
        title: "New folder",
        label: "Folder name",
        confirmText: "Create",
      });
      if (!name) return null;
      const folder = await createFolder(p.id, name);
      await refresh();
      toast("success", `Folder “${folder.name}” created`);
      return folder;
    } catch (e) {
      fail(e);
      return null;
    }
  }

  async function editFolder(f: Folder): Promise<void> {
    try {
      const name = await dialog.prompt({
        title: "Rename folder",
        label: "Name",
        defaultValue: f.name,
        confirmText: "Rename",
      });
      if (name && name !== f.name) {
        const newSlug = await renameFolder(f, name);
        await refresh();
        syncFolderSlugInUrl(f, newSlug);
        toast("success", "Folder renamed");
      }
    } catch (e) {
      fail(e);
    }
  }

  async function deleteFolder(f: Folder): Promise<boolean> {
    try {
      const dcount = documents.filter((d) => d.folder_id === f.id).length;
      const ok = await dialog.confirm({
        title: "Delete folder",
        message: `Delete folder “${f.name}” and its ${dcount} document(s)? This cannot be undone.`,
        confirmText: "Delete",
        danger: true,
      });
      if (!ok) return false;
      await removeRecord("folders", f.id);
      await refresh();
      toast("success", `Folder “${f.name}” deleted`);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function newDocument(
    p: Project,
    folderId: string | null,
  ): Promise<DocumentRec | null> {
    try {
      const title = await dialog.prompt({
        title: "New document",
        label: "Document title",
        confirmText: "Create",
      });
      if (!title) return null;
      const doc = await createDocument(p.id, folderId, title, p.type);
      await refresh();
      toast("success", `Document “${doc.title}” created`);
      return doc;
    } catch (e) {
      fail(e);
      return null;
    }
  }

  // One-click note in the user's workspace — no prompt, no title. Caller navigates (into split mode).
  async function newQuickNote(): Promise<DocumentRec | null> {
    try {
      const workspace = projects.find((p) => p.is_workspace && p.owner === uid);
      if (!workspace) {
        toast("error", "No workspace found. Sign in to take quick notes.");
        return null;
      }
      const note = await createQuickNote(workspace.id);
      await refresh();
      toast("success", "Quick note created");
      return note;
    } catch (e) {
      fail(e);
      return null;
    }
  }

  // Direct renames (no prompt dialog) for the inline breadcrumb editor. Return whether anything
  // changed so the caller can re-sync the URL slug afterwards.
  async function submitFolderName(f: Folder, name: string): Promise<boolean> {
    const next = name.trim();
    if (!next || next === f.name) return false;
    try {
      const newSlug = await renameFolder(f, next);
      await refresh();
      syncFolderSlugInUrl(f, newSlug);
      toast("success", "Folder renamed");
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function submitDocTitle(
    d: DocMeta | DocumentRec,
    title: string,
  ): Promise<boolean> {
    const next = title.trim();
    if (!next || next === d.title) return false;
    try {
      await renameDocument(d.id, next);
      qc.setQueryData<DocumentRec>(treeKeys.document(d.id), (old) =>
        old ? { ...old, title: next } : old,
      );
      await refresh();
      toast(
        "success",
        d.is_quick_note ? "Quick note renamed" : "Document renamed",
      );
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function editDocument(
    d: DocMeta | DocumentRec,
  ): Promise<string | null> {
    const isNote = d.is_quick_note;
    try {
      const title = await dialog.prompt({
        title: isNote ? "Rename quick note" : "Rename document",
        label: "Title",
        defaultValue: d.title,
        placeholder: isNote ? formatDateTime(d.created_at) : undefined,
        confirmText: "Rename",
      });
      if (title && title !== d.title) {
        await renameDocument(d.id, title);
        // Keep the open document's detail cache (['document', id]) in sync — refresh() only
        // invalidates the tree lists, not the per-document query the doc page reads from.
        qc.setQueryData<DocumentRec>(treeKeys.document(d.id), (old) =>
          old ? { ...old, title } : old,
        );
        await refresh();
        toast("success", isNote ? "Quick note renamed" : "Document renamed");
        return title;
      }
      return null;
    } catch (e) {
      fail(e);
      return null;
    }
  }

  async function deleteDocument(d: DocMeta | DocumentRec): Promise<boolean> {
    const isNote = d.is_quick_note;
    try {
      const ok = await dialog.confirm({
        title: isNote ? "Delete quick note" : "Delete document",
        message: isNote
          ? "Delete this quick note? This cannot be undone."
          : `Delete “${d.title}”? This cannot be undone.`,
        confirmText: "Delete",
        danger: true,
      });
      if (!ok) return false;
      await removeRecord("documents", d.id);
      qc.removeQueries({ queryKey: treeKeys.document(d.id) });
      await refresh();
      toast(
        "success",
        isNote ? "Quick note deleted" : `Document “${d.title}” deleted`,
      );
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  return {
    newProject,
    editProject,
    deleteProject,
    newFolder,
    editFolder,
    deleteFolder,
    newDocument,
    newQuickNote,
    editDocument,
    deleteDocument,
    submitFolderName,
    submitDocTitle,
  };
}
