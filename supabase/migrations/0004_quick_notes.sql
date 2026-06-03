-- Claudia — Quick notes.
--
-- A "quick note" is an ordinary document with no title and a short nanoid slug, created with one
-- click so you can jot something down without thinking about a name or where it belongs. Quick notes
-- live at the root of a user's My Workspace (folder_id = null) and are surfaced in their own
-- "Quick notes" section. They are normal documents in every other respect — they can later be given
-- a title, moved into a folder, etc. — so the only thing we persist is the flag below.
--
-- Idempotent: safe to re-run in the Supabase SQL editor.

alter table public.documents
  add column if not exists is_quick_note boolean not null default false;

-- Quick-note lookups are scoped to "root docs of a project flagged as quick notes"; a partial index
-- keeps the My Workspace dashboard's quick-notes section fast as the count grows.
create index if not exists documents_quick_notes
  on public.documents (project_id)
  where is_quick_note;
