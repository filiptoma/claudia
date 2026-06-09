-- 0029 — Ensure resource_grants has NON-PARTIAL unique indexes for the upsert ON CONFLICT targets.
-- Apply after 0023–0028 (dashboard SQL editor).
--
-- SYMPTOM
--   Granting access to a folder/document (setResourceGrant upsert, and redeem_invite's
--   `on conflict (folder_id, user_id)` / `(document_id, user_id)`) failed with
--   `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`.
--
-- CAUSE
--   The live DB's resource_grants unique indexes were missing, or were an older PARTIAL version
--   (e.g. `... WHERE folder_id IS NOT NULL`). PostgreSQL only infers a NON-PARTIAL unique index for a
--   bare `ON CONFLICT (cols)`, so a partial index can't satisfy the upsert. 0023 already declares these
--   as non-partial, but `create unique index if not exists` skips by NAME — it will NOT replace an
--   already-present partial index, so drifted environments need this explicit drop+recreate.
--
-- SAFE: drop is by name (clears a wrong/partial definition); NULLs are distinct in Postgres, so the two
-- indexes never collide (document-grant rows have folder_id NULL and vice-versa). No data is touched.

drop index if exists public.resource_grants_folder_user_uk;
drop index if exists public.resource_grants_document_user_uk;

create unique index resource_grants_folder_user_uk
  on public.resource_grants (folder_id, user_id);
create unique index resource_grants_document_user_uk
  on public.resource_grants (document_id, user_id);
