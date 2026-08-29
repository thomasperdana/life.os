# SPEC — Scriptorium: a PDF + Audio Library SaaS on Next.js, Supabase, and Vercel

> **Status:** **P0, P1 and P2 built and verified** against a live Supabase project (2026-08-29); P3 onward specified, not built.
> Implementation: [`../scriptorium`](../scriptorium).  Working name **Scriptorium** (proposed).
> **Written:** 2026-08-29 · **Spec version:** 3.2.0
> **Repo:** `/Volumes/181TB/Developers-LLC/life.os` · **Siblings:** [SPEC.1.md](SPEC.1.md), [SPEC.2.md](SPEC.2.md) (the iOS Bible-study app; different product, same house style)
>
> **v3.2 change — upload and download made first-class.** §7.2 is now a full admin upload
> contract covering PDF *and* MP3 (validation by magic bytes, per-type metadata extraction,
> direct-to-storage transfer). New §7.5 defines who counts as an admin and how that is checked.
> §8.1 and §8.6 each carry their own complete download design instead of one deferring to the
> other. §6 corrected against the live database: identifiers are `uuid`, not `text`.
>
> **v3.1 change — storage moved off GitHub.** Content now lives in **Supabase Storage**, the database is **Supabase Postgres**, and the app runs on **Vercel**. This deletes the GitHub bandwidth-discretion risk (old §4.1), the release-asset signer, and the Cloudflare R2 cache tier. What replaces it is a metered bill instead of a suspension email. Rewritten throughout: §1, §4, §5, §6, §7, §8.1, §8.6, §11, §14, §16.

---

## 0. Three Assumptions, Stated Up Front

You asked for nine features and did not have time for my clarifying questions, so I made three calls. Each is cheap to reverse; each is flagged where it bites.

| # | Ambiguity | Call made | Reverse it by |
|---|---|---|---|
| **A1** | "allow user to have review" | **User-written reviews and 1–5 star ratings on each content item**, publicly visible, with a moderation queue (§10) | If you meant a personal re-reading surface over your own bookmarks, delete §10 and fold it into §8.4; if you meant a rating prompt, delete §10 entirely |
| **A2** | Who may read the content | **Content is subscriber-gated.** This is what forces the private-bucket + signed-URL design (§7) | If content is free, buckets go public and §7 collapses to plain CDN URLs |
| **A3** | "download PDF" / "download MP3" | **Both readings served, for both formats**: an admin uploads the file into storage (§7.2), *and* a subscriber may download it locally (§8.1 PDF, §8.6 MP3) | If subscribers must never hold the file, drop the download routes and keep in-browser read/stream only |

---

## 1. Context & Problem

You have a library of written and spoken material and no good way to deliver it. Files in a folder solve storage and solve nothing else: there is no reading experience, no way to remember where you stopped, no way to keep a thought next to the paragraph that caused it, and no way to charge for any of it.

This spec describes the delivery layer. A subscriber signs in, reads a PDF in the browser, listens to an MP3 with their place kept, marks passages, writes against them, and reviews what they finished.

**Two decisions shape everything below.**

**This is a web SaaS, not an iOS app.** That deletes Apple's Guideline 3.1.1, the 15–30% commission, the reader-app carve-out, and App Review. Stripe becomes ordinary billing.

**Supabase is the whole backend.** Postgres, object storage, and auth from one vendor, deployed on Vercel. The alternative I specified first — GitHub Releases as the content store — traded a monthly bill for a policy risk, because GitHub reserves the right to throttle or delete repositories it decides are straining its infrastructure. Supabase charges you instead of judging you. For a product whose whole value is that the files are reliably there, a priced line item beats a discretionary one.

---

## 2. Product Definition

**One sentence:** a subscription library where your PDFs and audio become a real reading and listening experience, with bookmarks, journals, and reviews kept per user.

### 2.1 The two symmetric halves

The feature list is two parallel columns, and the schema should say so out loud:

| Reading | Listening |
|---|---|
| PDF rendered in-browser (§8.2) | MP3 played in a persistent player (§8.6) |
| Reading bookmarks — page anchored (§8.3) | Listening bookmarks — timestamp anchored (§8.7) |
| Reading journals (§8.4) | Listening journals (§8.8) |
| Progress: furthest page, percent | Progress: position in seconds, percent |

One `kind` discriminator (`reading` | `listening`) runs through `bookmarks`, `journals`, and `progress` rather than six near-identical tables. Anchors differ; everything else is the same shape.

### 2.2 Personas

- **Subscriber** — reads, listens, marks, writes, reviews.
- **Free visitor** — browses the catalog and previews; cannot open gated content.
- **Admin (you)** — uploads content, edits metadata, moderates reviews.

---

## 3. Non-Goals

- **No native mobile app.** Responsive web, installable as a PWA. A native client is a later decision.
- **No authoring in-app.** PDFs and MP3s are produced elsewhere; upload is the ingest boundary.
- **No DRM.** Watermarking is offered (§8.1); genuine DRM is not attempted, because it does not work and it degrades the honest reader's experience.
- **No social graph.** Reviews are the only public user content. No following, no comments, no messaging.
- **No multi-tenancy.** One library, one publisher (you), many subscribers.
- **No video** in v1. It changes the egress math by an order of magnitude (§4.1).

---

## 4. Verified Constraints

Checked 2026-08-29. Sources in §16.

### 4.1 Supabase tier limits are the real design constraint

Verified figures:

| | Free | Pro |
|---|---|---|
| Database size | 500 MB | 8 GB included, then **$0.125/GB** |
| File storage | 1 GB | 100 GB included, then **$0.0213/GB** |
| Egress | 5 GB | 250 GB included, then **$0.09/GB** |
| Cached egress | 5 GB | 250 GB included, then **$0.03/GB** |
| Max file upload | **50 MB** | 500 GB |
| Projects | 2 active, **paused after 1 week idle** | No pause |

> **Consequence 1 — the free tier cannot host this product.** Three independent blockers: a 50 MB upload ceiling that a single 45-minute MP3 can exceed; 1 GB of storage, roughly seventeen audio files; and automatic project pausing after a week of inactivity, which is disqualifying for anything a paying subscriber relies on. **Free tier is for local development. Pro is the production floor.**

> **Consequence 2 — egress is the metered resource, and it is cheap.** An MP3 at 128 kbps is about 58 MB per hour. A subscriber listening ten hours a month moves roughly 0.58 GB. The 250 GB included in Pro therefore covers about **430 active listeners** before a cent of overage, and each listener past that costs about **$0.05/month**. PDFs are rounding error by comparison. This is the number that makes the whole product viable, and it is worth re-deriving whenever bitrate or listening habits change.

> **Consequence 3 — caching still pays, but it is now an optimization, not survival.** Cached egress is $0.03/GB against $0.09/GB uncached. Serve media through the CDN and the bill drops by two thirds. Under the old GitHub design the cache tier existed to avoid being suspended; here it exists to save money, which is a much better reason and a much later priority.

### 4.2 Supabase signed URLs survive key rotation

Supabase Storage signed URLs are *"signed with a dedicated internal key that is separate from your project's Auth JWT signing key,"* so they remain valid across Auth key rotation, legacy key disabling, and signing-algorithm changes. They expire only on their own timer.

```js
const { data, error } = await supabase.storage
  .from('content')
  .createSignedUrl('audio/genesis-01.mp3', 3600)  // seconds
```

> **Consequence.** URL TTL is a free design variable rather than a hostage to auth configuration. Use short TTLs for PDF downloads (minutes) and longer ones for audio streams (hours), so a signed URL does not expire mid-listen.

### 4.3 Apple's payment rules do not apply here

Guideline 3.1.1 requires In-App Purchase to unlock content *within an app*. A website is not an app.

> **Consequence.** Stripe handles subscriptions at Stripe's rates, with no platform commission and no App Review. If a native iOS client is ever built this returns in force, and the reader-app carve-out (3.1.3(a)) becomes the path — PDFs and audio fit its "books, audio" category precisely. Noted so the entitlement model in §9 stays portable to that future.

### 4.4 Gates on claims not verified this session

Contracts asserted below that must be confirmed against live behavior before being relied on:

- ☑ **Supabase Storage honours HTTP range requests** on signed URLs. **CLOSED 2026-08-29 by live probe** (`scriptorium/scripts/verify-p1.ts`): `Range: bytes=0-15` returned `HTTP 206` with `content-range: bytes 0-15/1210` on PDF and `bytes 0-15/16730` on MP3. Audio seeking is viable; P5 does not double in cost.
- ☐ Maximum accepted value for `createSignedUrl` expiry.
- ☐ Current Supabase Pro monthly base price.
- ☐ Whether Supabase Storage egress is billed as cached or uncached when fronted by its CDN, and what triggers each.
- ☐ Vercel serverless function request-body ceiling on the deployed plan, which decides whether admin uploads may pass through a route handler or must go browser-direct to Supabase (§7.2).

---

## 5. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser — Next.js App Router, React Server Components         │
│  PDF viewer (pdf.js) · persistent audio player · PWA shell     │
├───────────────────────────────────────────────────────────────┤
│  VERCEL — Next.js Route Handlers (Node runtime) + Cron         │
│  /api/content/[id]/url   · signed-URL minting, entitlement     │
│  /api/stripe/webhook     · raw-body signature verification     │
│  /api/admin/upload-url   · signed upload ticket (admin only)   │
│  /api/admin/content      · ingest, validate, extract metadata  │
│  /api/content/[id]/download · gated file download               │
│  /api/bookmarks /journals /reviews /progress                   │
├───────────────────────────────────────────────────────────────┤
│  Server modules                                                │
│  entitlement.ts · storage.ts · ingest.ts                       │
│  stripe.ts · moderation.ts                                     │
├───────────────────────────┬───────────────────────────────────┤
│  SUPABASE                 │  STRIPE                           │
│  • Postgres (Drizzle)     │  billing of record                │
│  • Storage (private       │                                   │
│    bucket, signed URLs)   │                                   │
│  • Auth (sessions, OAuth) │                                   │
│  • RLS as second fence    │                                   │
└───────────────────────────┴───────────────────────────────────┘
```

Three vendors, not five. The old design needed GitHub for source, R2 for cache, and Neon for Postgres; Supabase collapses all three.

### 5.1 Stack

| Choice | Value | Why |
|---|---|---|
| Framework | **Next.js 16, App Router**, TypeScript strict | Server Components keep entitlement checks on the server by default |
| Runtime | **Node.js** for every route touching secrets | Stripe SDK and the Supabase service-role key require it |
| Package manager | **bun** | Standing rule; Node remains the deploy runtime |
| Hosting | **Vercel** | First-class Next.js target; Cron for scheduled work |
| Database | **Supabase Postgres** | Managed, with storage and auth attached |
| ORM | **Drizzle** | SQL-first, honest generated types, cheap migrations. Points at Supabase's connection pooler |
| Object storage | **Supabase Storage**, private bucket | Signed URLs, S3 semantics, same vendor as the database |
| Auth | **Supabase Auth** | The reason to pick Supabase: `auth.uid()` makes RLS real. Alternative: Auth.js if vendor portability outranks integration |
| Payments | **Stripe** — Checkout + Customer Portal + webhooks | Never hand-roll billing UI |
| PDF | **pdf.js** via `react-pdf`, text layer on | Text layer is required for selection-anchored bookmarks (§8.3) |
| Audio | Native `<audio>` + **Media Session API** | Lock-screen and headphone controls for free |
| Editor | **Tiptap** or plain Markdown | Journals are prose, not documents |
| Ingest parsing | **pdf-lib** (pages, watermark) · **music-metadata** (duration) | Both run server-side on ingest only (§7.2) |

### 5.2 Two fences, and which one is load-bearing

**Fence one — application entitlement.** `getEntitlement(userId)` reads the `subscriptions` table that Stripe webhooks keep current (§9.4). Every gated route and gated Server Component calls it. This is the load-bearing check.

**Fence two — Row Level Security.** RLS is enabled on every table in `public`, with policies keyed on `auth.uid()`: a user reads and writes only their own progress, bookmarks, and journals. Server code that legitimately needs to cross users (webhooks, admin, moderation) uses the **service-role key**, which bypasses RLS by design.

The distinction that matters: **RLS is defense in depth, not the entitlement system.** It stops a leaked anon key from exposing another user's journal. It does not know what a subscription is. Do not encode billing logic in policies — it will drift from Stripe and you will not notice.

**The service-role key bypasses RLS entirely.** It is a server-only secret, never in a `NEXT_PUBLIC_` variable, never imported into a Client Component, never sent to the browser under any circumstance.

---

## 6. Data Model

**Verified against the live database 2026-08-29:** `auth.users.id` is **`uuid`**, so every
identifier below is `uuid` — not `text`. A `text` foreign key to it fails outright with
*"key columns are of incompatible types."*

```sql
-- Supabase Auth owns auth.users. Everything below lives in public
-- and references auth.users(id) uuid on delete cascade.

profiles (
  id,                          -- = auth.users.id
  display_name, avatar_url, role,   -- 'member' | 'admin'
  created_at
)

subscriptions (
  user_id, stripe_customer_id, stripe_subscription_id,
  status,                      -- active|trialing|past_due|canceled|incomplete
  price_id, current_period_end, cancel_at_period_end,
  updated_at                   -- webhook-written only
)

content_items (
  id, slug, kind,              -- 'pdf' | 'audio'
  title, description, cover_path, series, sort_order,
  storage_bucket, storage_path,     -- Supabase Storage location
  byte_size, checksum, mime_type,
  page_count,                  -- pdf only
  duration_seconds,            -- audio only
  access_tier,                 -- 'free' | 'subscriber'
  status,                      -- 'draft' | 'published' | 'archived'
  published_at, created_at, updated_at
)

progress (
  user_id, item_id, kind,      -- 'reading' | 'listening'
  page, position_seconds, percent, updated_at,
  PRIMARY KEY (user_id, item_id)
)

bookmarks (
  id, user_id, item_id, kind,
  page, position_seconds,      -- one is null, per kind
  text_anchor,                 -- jsonb: quads + quoted text, pdf only
  label, color, created_at
)

journals (
  id, user_id, item_id, bookmark_id,   -- nullable: free-standing or anchored
  kind, body_md, created_at, updated_at
)

reviews (
  id, user_id, item_id, rating,        -- 1..5
  body, status,                        -- 'pending'|'published'|'rejected'
  moderated_by, moderated_at, created_at,
  UNIQUE (user_id, item_id)
)

processed_events (  id, type, processed_at )   -- Stripe webhook idempotency
download_events  (  id, user_id, item_id, ip_hash, user_agent, created_at )
```

**Why one `bookmarks` table and not two.** Reading and listening bookmarks differ in exactly one column — the anchor. Every query you actually write ("this user's bookmarks, newest first", "this item's bookmarks with their journals") wants them together. Two tables makes each of those a `UNION`. A `kind` discriminator plus a check constraint (`kind='reading'` requires `page`; `kind='listening'` requires `position_seconds`) keeps it honest in the database.

**Why `profiles` exists.** Supabase owns `auth.users` and you should not add columns to it. `profiles` is the app-owned mirror, created by a trigger on user signup, and it is where `role` lives.

**`content_items.status`** replaces the old manifest's implicit publish state: upload, fill in metadata, then publish deliberately.

---

## 7. Content Pipeline

The old design synced a `catalog.json` from a private repo. That indirection is gone. Supabase Storage is the source of record and the delivery path, and the admin UI is the ingest boundary.

### 7.1 Bucket layout

One private bucket, `content`:

```
content/
  pdf/{slug}.pdf
  audio/{slug}.mp3
  covers/{slug}.jpg        ← public bucket; covers are not secret
```

Private by default. Nothing is readable without a signed URL, which means nothing is readable without passing §5.2's first fence.

### 7.2 Upload — admin, both formats

Admin-only (§7.5), at `/admin/content/new`. One flow, two formats, differing only where they must.

**The transfer goes browser-direct to Supabase, never through Vercel.** A route handler mints a
short-lived signed *upload* ticket; the browser PUTs the bytes straight to Supabase Storage.
Routing a 200 MB MP3 through a serverless function wastes execution time, risks the platform
body-size ceiling (gated at §4.4), and buys nothing.

```
Browser (admin)                 Vercel                        Supabase Storage
      │                            │                                  │
      │ POST /api/admin/upload-url │                                  │
      │  {filename, kind, size}    │                                  │
      │───────────────────────────>│ assertAdmin()  (§7.5)            │
      │                            │ reject bad ext / oversize        │
      │                            │ createSignedUploadUrl(path) ─────>│
      │<────── {url, token, path} ─│                                  │
      │                                                               │
      │ PUT the bytes ────────────────────────────────────────────────>│
      │                                                               │
      │ POST /api/admin/content    │                                  │
      │  {path, kind, metadata}    │──── read header bytes ──────────>│
      │                            │ sniff magic bytes, extract meta  │
      │                            │ INSERT content_items status=draft│
```

**Accepted formats.** Nothing else is accepted, at either end:

| Kind | Extension | MIME | Magic bytes | Extracted on ingest |
|---|---|---|---|---|
| `pdf` | `.pdf` | `application/pdf` | `25 50 44 46` (`%PDF`) | `page_count` via `pdf-lib` |
| `audio` | `.mp3` | `audio/mpeg` | `49 44 33` (`ID3`) or `FF Fx` frame sync | `duration_seconds` via `music-metadata` |

**Validate by magic bytes, never by the client's claim.** Extension and `Content-Type` both come
from the browser and both are trivially forged. After upload the server reads the first bytes of
the stored object and confirms the signature matches `kind`. A mismatch deletes the object and
fails the request. This is the one check that stops the content bucket becoming a file-drop for
anything an admin account can be tricked into uploading.

**Size ceiling** is Supabase's, not ours: 50 MB on free, far higher on Pro (§4.1). The route
rejects oversize requests *before* minting a ticket, so the failure arrives in a second rather
than after a long upload. A 45-minute MP3 at 128 kbps is roughly 43 MB, which clears the free
ceiling only barely — another reason §4.1 calls Pro the production floor.

**Then metadata, then publish.** Ingest inserts `status='draft'` with `byte_size`, `checksum`,
`mime_type`, and the per-type field above. The admin fills in title, series, sort order, cover,
and access tier, then publishes deliberately. Nothing reaches `/library` until `status='published'`.

**Replacing a file.** Uploading over an existing item writes a new object, updates `checksum`, and
keeps the row. Bookmarks survive by design — §8.3's text anchors are what make a re-upload safe
for reading; timestamp anchors (§8.7) survive only if the audio was not re-cut, so a changed
`duration_seconds` flags affected listening bookmarks as approximate.

### 7.3 Signed delivery

```
Browser → GET /api/content/{id}/url
            ├─ session? ──────────── no ──→ 401
            ├─ item.status='published'? ─ no ──→ 404
            ├─ getEntitlement(userId) vs item.access_tier ─ fail ─→ 402
            └─ createSignedUrl(path, ttl) ──→ 200 { url, expiresAt }
```

TTL is a function of **(kind, purpose)**, not kind alone:

| | read | download |
|---|---|---|
| PDF | **2 hours** | **5 minutes** |
| audio | **4 hours** | **4 hours** |

The original "PDF = 5 minutes, it is fetched once immediately" holds for *downloading* and is wrong
for *reading*: pdf.js lazily range-fetches pages across an entire session, so a 5-minute URL dies
mid-read on any large document. Reading gets a session-length TTL; downloading keeps the short one.

The client caches the URL until `expiresAt` and re-requests when it lapses. The audio player also re-requests on any 403 during seek, which is the belt to that TTL's braces.

**No file is ever proxied through a route handler.** The server's only job is to decide and to sign. Proxying would put every byte of egress through Vercel's compute and bill it twice.

### 7.4 Why there is no cache tier here

The old §7.4 argued for Cloudflare R2 in front of GitHub for three reasons: throttling risk, short signed-URL TTLs, and unproven range-request support. Supabase answers two outright — egress is priced rather than policed (§4.1), and TTL is a free variable (§4.2). The third, range requests, is now the single open gate at §4.4.

Serving through Supabase's CDN drops egress from $0.09/GB to $0.03/GB (§4.1 Consequence 3). That is a real saving and a P8 concern, not a P1 one. **Ship without a cache tier. Add it when the bill says to.**

### 7.5 Who counts as an admin

`profiles.role` is `'member'` or `'admin'`. Nothing in the application can promote a user —
the column is granted by hand, in the Supabase SQL editor, on a deliberate decision:

```sql
update public.profiles set role = 'admin' where id = '<uuid>';
```

Every admin route and every admin Server Component calls one guard:

```ts
// server-only. Throws or redirects; never returns a boolean the caller can forget to check.
async function assertAdmin(): Promise<{ userId: string }>
```

Three rules, and the third is the one people get wrong:

1. **The guard reads `profiles.role` from the database on every call.** Never from a JWT claim,
   never from a cookie, never from client state.
2. **Hiding the admin nav is not access control.** Every `/api/admin/*` route re-checks
   independently of any UI.
3. **RLS does not protect the admin surface.** Admin writes run through the service-role client,
   which bypasses every policy by design (§5.2). `assertAdmin()` is therefore the *only* thing
   standing between a signed-in member and the content table. It is the highest-value function in
   the codebase to get right and to test (§13).

---

## 8. The Nine Features

Your list, one subsection each, in your order.

### 8.1 Upload and download PDF — *your item 1*

**Admin upload:** §7.2, `kind='pdf'`, validated by the `%PDF` signature, `page_count` extracted
on ingest.

**Subscriber download:** `GET /api/content/{id}/download`.

```
├─ session?                              no ──→ 401
├─ item.status = 'published'?            no ──→ 404
├─ canAccess(entitlement, access_tier)?  no ──→ 402
├─ rate limit ok?                        no ──→ 429
├─ INSERT download_events                          (abuse signal, §11)
└─ watermark? ─ no ──→ 302 to a 5-minute signed URL
                └ yes ─→ stream a per-user stamped copy
```

**Watermarking is the one case a file legitimately passes through a route handler**, because the
bytes are being modified per user. `pdf-lib` stamps a footer on each page: subscriber email,
timestamp, and a short opaque token tying the copy to the `download_events` row. Everything else
redirects, so no ordinary download burns Vercel compute or double-bills egress.

It is not DRM and is not claimed to be (§3). It makes casual redistribution traceable and costs
the honest reader nothing.

**Why 5 minutes.** A PDF download is fetched once, immediately. A short TTL means a leaked URL is
worthless within the length of a coffee break.

### 8.2 Read the PDF — *your item 2*

`react-pdf` over pdf.js, in a dedicated reader route.

- **Text layer enabled** — mandatory, because §8.3 anchors to selected text.
- Continuous scroll and single-page modes; fit-width, fit-page, pinch zoom.
- Keyboard: arrows, `j`/`k`, `g` to jump, `/` to search.
- **Progress written on a debounce** (~3 s idle, or on unmount), not on every scroll event, and
  flushed via `sendBeacon` on `pagehide`/`visibilitychange` so closing the tab keeps your place.
- **Current page is computed from scroll position, ranked by visible area** — not by
  `IntersectionObserver`, and not by `intersectionRatio`. IO does not fire while the document is
  hidden, which is precisely when the unload flush needs an accurate page; and a page taller than
  the viewport can never reach a high ratio, so ratio ranking picks the wrong page. `requestAnimationFrame`
  is also throttled to a stop in hidden tabs, so the scroll throttle is timestamp-based.
- **The resume decision is made on the server and expressed as `?page=N`.** The banner is
  server-rendered (no flash, no pdf.js dependency) and a resumed position is a shareable,
  bookmarkable URL. An explicit `?page=` suppresses the prompt.
- **The reader is loaded with `ssr: false`.** pdf.js needs `DOMMatrix`, which does not exist on the
  server; without this the route 500s.
- Full-text search within the document via pdf.js's own index.

### 8.3 Reading bookmarks — *your item 3*

Two kinds, deliberately:

| Kind | Anchor | Created by |
|---|---|---|
| **Page bookmark** | `page` | The bookmark button |
| **Highlight** | `page` + `text_anchor` jsonb (quads + the quoted text) | Selecting text |

Storing the **quoted text alongside the coordinates** is what lets a highlight survive a re-uploaded PDF whose pagination shifted: coordinates fail, text search recovers it, and the bookmark is flagged *"position approximate"* rather than silently lost. This matters more now than it did before, because re-uploading a corrected PDF is a two-click operation (§7.2). Color labels for categorization; a sidebar lists them, each linking to its location.

### 8.4 Reading journals — *your item 4*

Prose, in two placements:

- **Anchored** to a bookmark, so a thought sits beside the sentence that caused it.
- **Free-standing** per item, for a response to the whole.

Markdown, autosaved on a debounce, full-text searchable across the library (Postgres `tsvector` on `body_md`). Exportable as Markdown, per item or entire.

Journals are private, always, protected by both fences (§5.2), and never enter the review pipeline.

### 8.5 Stripe subscription — *your item 5*

Full design in §9.

### 8.6 Upload, download, and play MP3 — *your item 7*

**Admin upload:** §7.2, `kind='audio'`, validated by the `ID3` or frame-sync signature,
`duration_seconds` extracted on ingest. Audio is the format that decides the storage and egress
bill (§4.1), so bitrate is a product decision, not an afterthought (§15 Q4).

**Subscriber download:** the same gate as §8.1, with two deliberate differences.

| | PDF | MP3 |
|---|---|---|
| Signed-URL TTL | 5 minutes | **4 hours** — a long listen must not expire mid-session |
| Watermarking | Per-page footer | **None.** Audio watermarking is either audible or defeated; neither is worth the transcode |
| Delivery | Redirect, or stream if watermarked | **Always redirect.** Never proxy audio through a function |

**Playback** is where the work is.

- **One `<audio>` element**, mounted in the root layout, owned by React context. It survives
  navigation, so the player does not restart when you browse elsewhere.
- **Media Session API** for lock-screen art, title, and headphone controls.
- Speed control (0.75×–2×), 15-second skip, sleep timer.
- **Position saved every 10 s and on pause/unload** via `navigator.sendBeacon`, so closing the tab
  does not lose your place.
- The player re-requests `/api/content/{id}/url` on any 403 during seek, which is the belt to the
  4-hour TTL's braces.
- Offline listening via PWA + Cache Storage, gated on entitlement at cache time.

> **Seeking is confirmed viable.** The §4.4 range-request gate was closed by live probe on
> 2026-08-29: Supabase returns `HTTP 206` with correct `content-range` headers for both formats.
> Scrubbing works against a plain signed URL, with no proxy and no transcode.

### 8.7 Listening bookmarks — *your item 8*

Timestamp-anchored, same table, `kind='listening'`. Marking while playing captures `position_seconds` **minus a 5-second lead-in**, because you always realize a passage mattered slightly after it started. Labels and colors as in §8.3. The sidebar seeks on click.

### 8.8 Listening journals — *your item 9*

§8.4 exactly, anchored to a timestamp instead of a page. Shared component, shared table, shared search index.

### 8.9 Reviews — *your item 6*

Full design in §10.

---

## 9. Payments & Entitlement

### 9.1 Products

Defined in the Stripe dashboard, never in code. Monthly and annual prices on one product; annual discounted. Optional 7-day trial. **Price IDs live in env vars**, so switching prices never ships a deploy.

### 9.2 Flows

| Flow | Mechanism |
|---|---|
| Subscribe | **Stripe Checkout**, hosted, redirect out and back |
| Manage, update card, cancel | **Stripe Customer Portal**, hosted |
| Recover failed payment | Stripe Smart Retries + dunning emails |

Nothing about billing is hand-built. Card data never touches your servers, which keeps PCI scope at SAQ-A.

### 9.3 Webhooks — the part that goes wrong

`POST /api/stripe/webhook`, Node runtime.

**The gotcha that costs an afternoon:** signature verification needs the *raw, unparsed* body. In the App Router, read it with `await req.text()` and pass that string to `stripe.webhooks.constructEvent` with the `stripe-signature` header. Any middleware or parser that touches the body first breaks verification with a misleading error.

Events handled: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.

Four rules:

1. **Webhooks are the only writer** of `subscriptions`. Success redirects update nothing — a user who closes the tab mid-redirect must still get access.
2. **Idempotent by `event.id`**, recorded in `processed_events`. Stripe retries; no-op on repeats.
3. **Verify or reject.** An unverified webhook is an unauthenticated request that grants subscriptions.
4. **Write with the service-role key.** The webhook has no user session, so it must bypass RLS (§5.2).

### 9.4 Entitlement

```ts
// server-only, the single source of truth
async function getEntitlement(userId: string): Promise<'free' | 'subscriber'>
```

Returns `subscriber` when a row exists with status `active` or `trialing` and `current_period_end` in the future. Called by every gated route and gated Server Component. `past_due` keeps access through the grace window; `canceled` retains access until `current_period_end`, because the user paid for the period.

---

## 10. Reviews & Moderation

> Built on assumption **A1** (§0). If you meant something else, this section is the one to delete.

### 10.1 Shape

One review per user per item (`UNIQUE (user_id, item_id)`), editable afterward. A 1–5 rating and optional prose. **Only users with recorded progress on an item may review it** — no reviews of things nobody opened.

Item pages show the aggregate, the distribution, and published reviews newest-first.

### 10.2 Moderation

Reviews are public user content, so they need a pipeline, not good intentions:

1. Submit → `status='pending'`.
2. Automated pass: profanity list, link and contact-detail stripping, a length floor.
3. Clean reviews auto-publish; flagged ones queue for you.
4. Admin queue: publish, reject with reason, or ban the author.
5. Any user can report a published review, which returns it to the queue.

RLS policy: a user may read published reviews and their own pending one, and may write only their own. Admin actions run service-role.

Rate limit: one submission per user per item per hour, to make abuse tedious.

### 10.3 Author's note

You will eventually receive a review you disagree with. The moderation queue exists for abuse, not for disagreement, and a library whose owner deletes criticism is worth less than one that does not. Write the rejection reasons down before you need them.

---

## 11. Security & Privacy

- **The service-role key is the crown jewel.** `SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS policy. Server-only, never `NEXT_PUBLIC_`, never in a Client Component, never logged. If it leaks, every subscriber's journals leak with it. The anon key is public by design and safe in the browser; do not confuse them.
- **Other server-only secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`. Set them as Vercel environment variables scoped to server runtime.
- **Both fences up** (§5.2): entitlement in application code, RLS on every `public` table. Enable RLS at table creation, not later — an unprotected table is only discovered by accident.
- **Buckets private by default.** Only `covers` is public. Verify bucket policy after every migration; a bucket flipped public is a silent total content leak.
- **Signed URLs are single-asset and time-boxed.** No URL grants a second file.
- **Journals are private**, always. Never indexed publicly, never used for recommendations, never included in an admin export. Say so in the privacy policy and mean it.
- **Rate limits** on `/api/content/*/url`, `/api/content/*/download`, and review submission. `download_events` is the abuse signal: one account pulling the whole catalog in an hour is a shared credential, and it is also an egress bill (§4.1).
- **Standard hygiene**: CSRF on mutations, `httpOnly` `secure` `sameSite` cookies, a CSP permitting pdf.js workers and blob URLs, parameterized queries via Drizzle, Zod validation at every route boundary.
- **GDPR**: export and delete endpoints covering the profile, progress, bookmarks, journals, reviews, storage objects, and the Stripe customer.

---

## 12. UI

| Route | Purpose |
|---|---|
| `/` | Marketing page, pricing, sample content |
| `/library` | Catalog with series grouping, filters, resume-where-you-left-off rail |
| `/read/[slug]` | PDF reader, bookmarks sidebar, journal panel |
| `/listen/[slug]` | Audio page, chapters, bookmarks sidebar, journal panel |
| `/notes` | Every bookmark and journal, cross-library, full-text searchable |
| `/account` | Subscription status, Customer Portal link, data export |
| `/admin/content` | Item list, publish/archive, replace file |
| `/admin/content/new` | Upload a PDF or MP3, then fill in metadata (§7.2) |
| `/admin/reviews` | Moderation queue |

Notes: the persistent player docks at the bottom across every route. Dark mode is a reading feature, not a preference. Type scale, line length, and margins are the product on `/read` — respect the reader's font-size choice rather than fixing it in pixels. Keyboard navigation throughout; screen-reader labels on every bookmark and player control.

---

## 13. Testing

- **Unit** (Vitest): entitlement matrix across every subscription status and period boundary; bookmark anchor serialization and recovery-by-text; watermark generation; signed-URL TTL selection by kind.
- **Webhooks** (the important suite): Stripe CLI fixtures for all six events, replayed out of order and duplicated, asserting `subscriptions` converges to the same state either way. Plus a tampered-signature test that must be rejected.
- **Admin gate** (the highest-value suite, §7.5): a signed-in member receives 403 from every
  `/api/admin/*` route; only `role='admin'` passes. Assert this per route, not once.
- **Upload validation** (§7.2): a `.pdf` whose bytes are a ZIP is rejected; an `.mp3` that is
  actually a PDF is rejected; an oversize request is refused before a ticket is minted; a rejected
  upload leaves no orphaned object in the bucket.
- **Download gate** (§8.1, §8.6): 401 unauthenticated, 404 for a draft item, 402 for a free
  account against a subscriber item, 302-with-signed-URL for an entitled one, and a
  `download_events` row written exactly once per successful download.
- **RLS** (the suite that only exists because of Supabase): with an anon-key client authenticated as user A, assert that user B's progress, bookmarks, journals, and pending reviews are all unreachable. This is the test that proves fence two is real rather than assumed.
- **Integration**: content route returns 401 without a session, 404 for a draft, 402 without entitlement, and a signed URL with one — against a real Supabase project in CI.
- **E2E** (Playwright): sign up → subscribe with a Stripe test card → open a PDF → bookmark → journal → sign out → sign back in → verify position, bookmark, and journal survived.

---

## 14. Build Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **P0** ✅ | Scaffold | **DONE 2026-08-29.** 9 tables live on PostgreSQL 17.6, RLS on all 9 with 10 policies, signup trigger, both buckets, Supabase Auth sign-in verified 7/7 end to end, `/library` renders empty |
| **P1** ✅ | Upload + download, both formats | **DONE 2026-08-29.** 16/16 storage + validation checks and 13/13 HTTP gate checks green against the live project: magic-byte validation rejects forged files, oversize refused pre-ticket, admin gate returns 401/403/200 correctly, serving gate returns 401 → 404 (draft) → 402 (unentitled) → 200 + signed URL in that order, PDF TTL 5 min |
| **P2** ✅ | Reader | **DONE 2026-08-29.** 18/18 automated checks plus browser verification: 8 pages render with live text layers (24 selectable spans), scroll tracking updates the page counter, position persists on a 3s debounce, and the resume prompt returns the reader to the saved page |
| **P3** | Bookmarks + journals (reading) | Highlight survives a re-uploaded PDF via text recovery |
| **P4** | Stripe | Full webhook suite green; subscribe, cancel, and lapse all produce correct entitlement |
| **P5** | Audio | **Range-request gate (§4.4) confirmed first.** Player survives navigation, position persists, Media Session controls work |
| **P6** | Bookmarks + journals (listening) | Shared components carry both halves; `/notes` searches across everything |
| **P7** | Reviews + moderation | Queue works; report flow returns a published review to it |
| **P8** | Hardening + cost | RLS suite green, rate limits, CSP, GDPR endpoints; CDN caching if the egress bill justifies it |

P4 before P5 is deliberate: billing is the feature most likely to reveal a wrong assumption, and it is cheaper to learn that before the audio work than after.

---

## 15. Open Questions

1. **Which assumption in §0 is wrong?** A1 most likely. Answer it before P7.
2. **Supabase Auth or Auth.js?** The spec picks Supabase Auth because `auth.uid()` is what makes RLS work. Auth.js is the answer if leaving Supabase later must stay cheap. Decide at P0; it is expensive to change at P4.
3. **Free tier shape.** Which items are `access_tier='free'`, and does a free account get bookmarks and journals? Recommendation: yes — they are the reason people return, and they make the subscription feel like a continuation rather than a purchase.
4. **Audio bitrate.** It sets the egress bill (§4.1). 128 kbps for spoken word is generous; 96 kbps or mono would cut the bill by a quarter to a half with little audible loss on speech.
5. **Series and ordering.** Is the library a linear course, a reference shelf, or both?
6. **Re-uploaded content.** §8.3's text recovery handles moved highlights. What should the user *see* — silent repair, or a notice that the source changed?
7. **Team or church accounts.** A congregation buying twenty seats changes the schema. Not v1, but knowing whether it is coming decides whether `subscriptions` keys on `user_id` or on an `org_id`.
8. **Email.** Transactional is Stripe's. New-content announcements are yours, and need a provider and a preferences table.
9. **Are the PDFs and MP3s yours to sell?** Not a technical question, and the one most likely to matter. Content licensing sits outside this spec entirely.

---

## 16. Sources

Checked 2026-08-29.

| Source | What it established |
|---|---|
| [Supabase Pricing](https://supabase.com/pricing) | Free vs Pro limits: database, storage, egress, 50 MB free upload cap, free-project pausing, overage rates. The whole of §4.1. |
| [Supabase Storage — Downloads](https://supabase.com/docs/guides/storage/serving/downloads) | `createSignedUrl` API; signed URLs use a dedicated key independent of Auth JWT signing, so they survive key rotation. §4.2. |
| [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | 3.1.1 requires IAP to unlock content in an app; 3.1.3(a) reader-app carve-out covers "books, audio." §4.3 — irrelevant to the web build, decisive for any future native client. |
| [GitHub Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) | Bandwidth discretion — GitHub may throttle, suspend, or delete repos for excessive use. The constraint that motivated moving storage to Supabase (§1). |
| [note.md](note.md) | Project context. |
| [SPEC.1.md](SPEC.1.md) · [SPEC.2.md](SPEC.2.md) | Sibling specs; house style and the iOS constraint set. |

---

*P0 is built and its claims were closed on tool evidence (migrations applied, RLS verified,
auth exercised end to end against the live project). Everything from P1 onward is specification.*

**Gotchas surfaced during P0/P1, recorded so they are not rediscovered:**

1. `auth.users.id` is `uuid`. A `text` foreign key to it fails outright. §6 is corrected.
2. Every `drizzle-kit generate` emits a spurious `CREATE TABLE "auth"."users"` that must be
   deleted before migrating. See `scriptorium/supabase/README.md`.
3. A `#` in the database password truncates the connection string at `.env` parse time *and*
   breaks URL parsing. Percent-encode the password and quote the value.
4. `DATABASE_URL` (pooler, 6543) and `DIRECT_URL` (direct, 5432) are **both** required and are
   **not** interchangeable. Local dev tolerates the direct URL for both; Vercel serverless does
   not — it exhausts direct connections, which is exactly what the transaction pooler exists to
   prevent. Set the pooler URL before the first deploy.
5. `server-only` belongs on modules that touch secrets, not on pure constant registries. Marking
   the format registry made it unimportable from tests for no security gain.
6. Seeding `numPages` from the DB page count means `setNumPages(n)` on document load is often a
   no-op; React bails out and any effect keyed on `numPages` never re-runs. Key page-tracking
   effects on a separate `docLoaded` flag.
7. React SSR emits `<!-- -->` between static text and interpolated values, so `Continue from page 11`
   is not a literal substring of the HTML. Strip comment markers before asserting on rendered text.
