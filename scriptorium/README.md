# Scriptorium

PDF + audio library SaaS. Spec: [`../docs/SPEC.3.md`](../docs/SPEC.3.md).

**P0 status: scaffold complete, unconnected.** Everything below builds and
typechecks; nothing has been run against a live Supabase project yet.

## Setup

1. **Create a Supabase project** (Pro tier for production — see SPEC §4.1; free
   tier caps uploads at 50 MB and pauses after a week idle).

2. **Fill in `.env.local`** from `.env.example`. Four values from
   Project Settings → API and → Database.

3. **Apply the schema:**
   ```bash
   bun run db:migrate
   psql "$DIRECT_URL" -f supabase/rls.sql
   ```
   Read [`supabase/README.md`](supabase/README.md) first — generated migrations
   contain one statement that must be deleted every time.

4. **Run it:**
   ```bash
   bun dev
   ```
   Sign up at `/signup`, confirm the email, and `/library` renders empty.

## Layout

| Path | Role |
|---|---|
| `src/db/schema.ts` | The §6 data model. One `kind` discriminator across bookmarks/journals/progress |
| `src/db/index.ts` | Drizzle over the transaction pooler (`prepare: false` is mandatory) |
| `src/lib/entitlement.ts` | **Fence one** (§5.2, §9.4) — the only access decision in the app |
| `src/lib/supabase/admin.ts` | Service-role client. Bypasses all RLS. Server-only |
| `supabase/rls.sql` | **Fence two** — policies, signup trigger, bucket creation |
| `src/proxy.ts` | Session refresh + route guard. Server Components cannot write cookies |

## Two things to know

**Entitlement is application code, not RLS.** RLS stops a leaked anon key from
exposing another user's journals. It knows nothing about subscriptions. Never
encode billing state in a policy — it drifts from Stripe silently (SPEC §5.2).

**`SUPABASE_SERVICE_ROLE_KEY` bypasses every policy.** Server-only, never
`NEXT_PUBLIC_`, never logged. If it leaks, every subscriber's journals leak.
