-- 0031 — When a suggestion is accepted, shift the OTHER pending suggestions' source offsets.
--
-- Bug: apply_suggestion() splices suggested_md in place of [source_start, source_end) in the document,
-- which moves every character after the edit by `delta = len(suggested_md) - (source_end-source_start)`.
-- The other pending suggestions kept their original offsets, so after one accept they pointed at the
-- wrong text — the inline diffs rendered in the wrong place (and the next accept could hit the stale
-- guard). Fix: in the same definer call, shift every other PENDING suggestion on the document that sits
-- after the edited region by `delta`.
--
-- Only suggestions are shifted: their inline diff is positioned by source_start/source_end. Comment
-- highlights re-locate by quote/prefix/suffix anchor (lib/anchor), not by stored offsets, so their
-- display is unaffected and we leave them untouched (avoids bumping updated_at / reordering).
--
-- Overlapping suggestions (start inside the edited span) are inherently ambiguous after an edit and are
-- left as-is — they'll trip apply_suggestion's own staleness check if someone later tries to accept one.
--
-- Recreates the 0018 definition (can_edit_document gate + status flip) plus the shift. Apply after 0030.

create or replace function public.apply_suggestion(p_suggestion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.suggestion_threads;
  cur text;
  v_delta int;
begin
  select * into s from public.suggestion_threads where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;
  if not public.can_edit_document(s.document_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'suggestion already resolved'; end if;
  select content into cur from public.documents where id = s.document_id;
  -- substr is 1-indexed; source_start is a 0-based JS offset.
  if substr(cur, s.source_start + 1, s.source_end - s.source_start) is distinct from s.original_md then
    raise exception 'stale: the document text changed since this suggestion was made';
  end if;

  update public.documents
     set content = left(cur, s.source_start) || s.suggested_md || substr(cur, s.source_end + 1)
   where id = s.document_id;                                       -- definer bypasses RLS; can_edit check above is the gate
  update public.suggestion_threads set status = 'accepted' where id = p_suggestion;

  -- Keep the still-pending suggestions anchored after the splice moved the text under them.
  v_delta := length(s.suggested_md) - (s.source_end - s.source_start);
  if v_delta <> 0 then
    update public.suggestion_threads
       set source_start = source_start + v_delta,
           source_end   = source_end   + v_delta
     where document_id = s.document_id
       and id <> p_suggestion
       and status = 'pending'
       and source_start >= s.source_end;
  end if;
end;
$$;
