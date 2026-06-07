-- 0013 — Add 'commenter' to the member_role enum.
--
-- MUST be run in its own SQL editor execution BEFORE 0014, because PostgreSQL forbids
-- referencing a newly-added enum value in the same transaction that adds it.
-- Run this file first, then run 0014_commenter_role_policies.sql.

ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'commenter' AFTER 'viewer';
