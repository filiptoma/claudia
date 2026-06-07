-- 0014 — Commenter permission tier: helpers, policies, RPCs.
--
-- Requires 0013 to have been committed first (enum value 'commenter' must exist).
-- Apply after 0001–0013.
--
-- Changes:
-- 1. New can_comment_project(): owner + commenter/editor members + admin/mod on PUBLIC only.
-- 2. Update can_view_project(): remove blanket is_staff() — staff behave like basic users on private.
-- 3. Update can_edit_project(): staff get editor-level access on PUBLIC only.
-- 4. New can_manage_project(): owner + admin (not mod) on PUBLIC projects.
-- 5. Update projects_select / projects_update / projects_delete policies.
-- 6. Restrict admin_projects view to public projects; admin-only (mods see nothing).
-- 7. annotation INSERT policies: require can_comment, not can_view.
-- 8. Update create_comment_thread + create_suggestion RPCs to gate on can_comment_project.

-- ---------- 1. can_comment_project ----------
CREATE OR REPLACE FUNCTION public.can_comment_project(pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT exists (
    SELECT 1 FROM public.projects p
    WHERE p.id = pid
      AND CASE
        WHEN p.is_workspace THEN p.owner = auth.uid()
        ELSE (
          p.owner = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = pid AND m.user_id = auth.uid()
              AND m.role IN ('commenter', 'editor')
          )
          -- admin/mod get commenter access on PUBLIC projects only
          OR (p.is_public AND public.is_staff())
        )
      END
  )
$$;

REVOKE ALL ON FUNCTION public.can_comment_project(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_comment_project(uuid) TO authenticated;

-- ---------- 2. can_view_project (drop blanket staff access) ----------
CREATE OR REPLACE FUNCTION public.can_view_project(pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT exists (
    SELECT 1 FROM public.projects p
    WHERE p.id = pid
      AND CASE
        WHEN p.is_workspace THEN p.owner = auth.uid()
        ELSE (
          p.is_public
          OR p.owner = auth.uid()
          OR public.is_member(pid)
          -- NOTE: is_staff() intentionally removed; admins/mods behave like regular users on private projects.
        )
      END
  )
$$;

-- ---------- 3. can_edit_project (staff → public only) ----------
CREATE OR REPLACE FUNCTION public.can_edit_project(pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT exists (
    SELECT 1 FROM public.projects p
    WHERE p.id = pid
      AND CASE
        WHEN p.is_workspace THEN p.owner = auth.uid()
        ELSE (
          p.owner = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = pid AND m.user_id = auth.uid() AND m.role = 'editor'
          )
          -- admin/mod get editor-level access on PUBLIC projects only
          OR (p.is_public AND public.is_staff())
        )
      END
  )
$$;

-- ---------- 4. can_manage_project (admin on public; mod excluded from manage) ----------
CREATE OR REPLACE FUNCTION public.can_manage_project(pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT exists (
    SELECT 1 FROM public.projects p
    WHERE p.id = pid
      AND CASE
        WHEN p.is_workspace THEN p.owner = auth.uid()
        ELSE (
          p.owner = auth.uid()
          OR (
            p.is_public
            AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin')
          )
        )
      END
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_project(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid) TO authenticated;

-- ---------- 5. projects_select/update/delete policies ----------
DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT
  USING (
    CASE
      WHEN is_workspace THEN owner = auth.uid()
      ELSE (is_public OR owner = auth.uid() OR public.is_member(id))
    END
  );

DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects FOR UPDATE
  USING (
    CASE
      WHEN is_workspace THEN owner = auth.uid()
      ELSE (
        owner = auth.uid()
        OR (is_public AND EXISTS (
          SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'
        ))
      )
    END
  )
  WITH CHECK (
    CASE
      WHEN is_workspace THEN owner = auth.uid()
      ELSE (
        owner = auth.uid()
        OR (is_public AND EXISTS (
          SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'
        ))
      )
    END
  );

DROP POLICY IF EXISTS projects_delete ON public.projects;
CREATE POLICY projects_delete ON public.projects FOR DELETE
  USING (
    CASE
      WHEN is_workspace THEN owner = auth.uid()
      ELSE (
        owner = auth.uid()
        OR (is_public AND EXISTS (
          SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'
        ))
      )
    END
  );

-- ---------- 6. restrict admin_projects view to public projects; admin only ----------
DROP VIEW IF EXISTS public.admin_projects;
CREATE VIEW public.admin_projects WITH (security_invoker = false) AS
  SELECT
    p.id, p.name, p.slug, p.is_public, p.owner,
    op.name  AS owner_name,
    op.email AS owner_email,
    p.created_at,
    p.updated_at
  FROM public.projects p
  LEFT JOIN public.profiles op ON op.id = p.owner
  WHERE NOT p.is_workspace
    AND p.is_public                                   -- only public projects in admin panel
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = auth.uid() AND pr.role = 'admin'  -- admin only (mod sees nothing here)
    );

GRANT SELECT ON public.admin_projects TO authenticated;

-- ---------- 7. annotation INSERT policies: require can_comment, not can_view ----------
DROP POLICY IF EXISTS ct_insert ON public.comment_threads;
CREATE POLICY ct_insert ON public.comment_threads FOR INSERT
  WITH CHECK (public.can_comment_project(project_id) AND author = auth.uid());

DROP POLICY IF EXISTS st_insert ON public.suggestion_threads;
CREATE POLICY st_insert ON public.suggestion_threads FOR INSERT
  WITH CHECK (public.can_comment_project(project_id) AND author = auth.uid());

-- ---------- 8. update RPCs to gate on can_comment_project ----------
CREATE OR REPLACE FUNCTION public.create_comment_thread(
  p_document uuid, p_anchor jsonb, p_source_start int, p_source_end int,
  p_body text, p_mentions uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; tid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  SELECT project_id INTO pid FROM public.documents WHERE id = p_document;
  IF pid IS NULL THEN RAISE EXCEPTION 'document not found'; END IF;
  IF NOT public.can_comment_project(pid) THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF coalesce(btrim(p_body), '') = '' THEN RAISE EXCEPTION 'comment body required'; END IF;
  INSERT INTO public.comment_threads (document_id, project_id, author, anchor, source_start, source_end)
    VALUES (p_document, pid, auth.uid(), p_anchor, p_source_start, p_source_end)
    RETURNING id INTO tid;
  INSERT INTO public.comments (thread_id, author, body, mentions)
    VALUES (tid, auth.uid(), p_body, coalesce(p_mentions, '{}'));
  RETURN tid;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_suggestion(
  p_document uuid, p_anchor jsonb, p_source_start int, p_source_end int,
  p_original_md text, p_suggested_md text, p_note text, p_mentions uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  SELECT project_id INTO pid FROM public.documents WHERE id = p_document;
  IF pid IS NULL THEN RAISE EXCEPTION 'document not found'; END IF;
  IF NOT public.can_comment_project(pid) THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  INSERT INTO public.suggestion_threads
    (document_id, project_id, author, anchor, source_start, source_end, original_md, suggested_md)
    VALUES (p_document, pid, auth.uid(), p_anchor, p_source_start, p_source_end, p_original_md, p_suggested_md)
    RETURNING id INTO sid;
  IF coalesce(btrim(p_note), '') <> '' THEN
    INSERT INTO public.suggestion_comments (suggestion_id, author, body, mentions)
      VALUES (sid, auth.uid(), p_note, coalesce(p_mentions, '{}'));
  END IF;
  RETURN sid;
END;
$$;
