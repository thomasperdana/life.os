# Database setup

Drizzle declares `auth.users` so `profiles.id` can carry a real foreign key to it,
but Supabase Auth owns that table. Every generated migration therefore contains a
spurious `CREATE TABLE "auth"."users"` that **must be deleted before it runs** —
the FK reference on the last line stays.

After each `bun run db:generate`, check the new file:

    grep -n 'CREATE TABLE "auth"' supabase/migrations/*.sql

Delete any block it finds, then:

    bun run db:migrate          # applies schema (uses DIRECT_URL)
    psql "$DIRECT_URL" -f supabase/rls.sql   # policies, trigger, buckets

`rls.sql` is idempotent and safe to re-run.
