-- Full-text search indexes for /notes — SPEC.3.md §8.4, §12.
-- Idempotent; safe to re-run.

-- Journals: search the prose.
create index if not exists journals_body_fts
  on public.journals using gin (to_tsvector('english', body_md));

-- Bookmarks: search the quoted passage and the label.
create index if not exists bookmarks_text_fts
  on public.bookmarks using gin (
    to_tsvector('english',
      coalesce(text_anchor ->> 'quotedText', '') || ' ' || coalesce(label, ''))
  );

-- Ordinary lookups behind the /notes listing.
create index if not exists journals_user_updated on public.journals (user_id, updated_at desc);
create index if not exists bookmarks_user_created on public.bookmarks (user_id, created_at desc);
