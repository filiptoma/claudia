-- 0019 — public document title lookup for link-preview (Open Graph) metadata.
-- Apply after 0001–0018 (single execution; no enum changes).
--
-- Link-preview crawlers (Messenger, Discord, Slack, Facebook, X…) are unauthenticated and don't run
-- JS, so the SPA's client-set <title> never reaches them. A Cloudflare Pages edge function injects the
-- right <title>/og:title into the served HTML; it calls this RPC to resolve a URL to a document title.
--
-- SECURITY: anon-callable on purpose, but it ONLY returns titles for PUBLIC, non-workspace projects —
-- exactly the documents any logged-out visitor can already read. Private/workspace/quick-note titles
-- never resolve here (they'd fall back to the generic "AstroNote" preview), so nothing leaks.
--
-- Document slugs are unique per project (documents unique(project_id, slug)), so a project slug + doc
-- slug pin a single document regardless of which folder it lives in — the URL's folder segment (when
-- present) doesn't need to be matched.
create or replace function public.public_document_title(p_project_slug text, p_doc_slug text)
returns text
language sql stable security definer set search_path = public as $$
  select d.title
  from public.documents d
  join public.projects p on p.id = d.project_id
  where p.slug = p_project_slug
    and p.is_public
    and not p.is_workspace
    and not d.is_quick_note
    and d.slug = p_doc_slug
  limit 1;
$$;

grant execute on function public.public_document_title(text, text) to anon, authenticated;
