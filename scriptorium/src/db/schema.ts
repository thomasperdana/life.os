/**
 * Scriptorium data model — SPEC.3.md §6.
 *
 * Supabase Auth owns `auth.users`. Everything here lives in `public` and
 * references it. We never add columns to auth.users; `profiles` is the
 * app-owned mirror (§6, "Why profiles exists").
 */
import {
  pgTable, pgSchema, pgEnum, text, uuid, timestamp, integer, boolean,
  jsonb, real, primaryKey, uniqueIndex, index, check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/** Supabase-managed. Declared only so we can reference it in foreign keys. */
const authSchema = pgSchema('auth')
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
})

// ─── Enums ────────────────────────────────────────────────────────────────

export const userRole = pgEnum('user_role', ['member', 'admin'])
export const contentKind = pgEnum('content_kind', ['pdf', 'audio'])
export const activityKind = pgEnum('activity_kind', ['reading', 'listening'])
export const accessTier = pgEnum('access_tier', ['free', 'subscriber'])
export const contentStatus = pgEnum('content_status', ['draft', 'published', 'archived'])
export const reviewStatus = pgEnum('review_status', ['pending', 'published', 'rejected'])
export const subStatus = pgEnum('sub_status', [
  'active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid',
])

// ─── Identity ─────────────────────────────────────────────────────────────

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  role: userRole('role').notNull().default('member'),
  /** Set by an admin (§10.2). A banned author cannot submit reviews. */
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Billing (§9) ─────────────────────────────────────────────────────────

/** Webhook-written ONLY (§9.3 rule 1). No other code path may write here. */
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id').primaryKey().references(() => profiles.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  status: subStatus('status').notNull(),
  priceId: text('price_id'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('subscriptions_customer_idx').on(t.stripeCustomerId)])

/** Stripe webhook idempotency (§9.3 rule 2). */
export const processedEvents = pgTable('processed_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Content (§6, §7) ─────────────────────────────────────────────────────

export const contentItems = pgTable('content_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  kind: contentKind('kind').notNull(),

  title: text('title').notNull(),
  description: text('description'),
  coverPath: text('cover_path'),
  series: text('series'),
  sortOrder: integer('sort_order').notNull().default(0),

  // Supabase Storage location (§7.1) — replaces the old github_* columns.
  storageBucket: text('storage_bucket').notNull().default('content'),
  storagePath: text('storage_path').notNull(),
  byteSize: integer('byte_size'),
  checksum: text('checksum'),
  mimeType: text('mime_type'),

  pageCount: integer('page_count'),              // pdf only
  durationSeconds: integer('duration_seconds'),  // audio only

  accessTier: accessTier('access_tier').notNull().default('subscriber'),
  status: contentStatus('status').notNull().default('draft'),

  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('content_series_idx').on(t.series, t.sortOrder),
  index('content_status_idx').on(t.status),
  // A pdf carries pages; audio carries duration. Enforced, not hoped for.
  check('content_kind_fields', sql`
    (${t.kind} = 'pdf'   AND ${t.durationSeconds} IS NULL) OR
    (${t.kind} = 'audio' AND ${t.pageCount}       IS NULL)
  `),
])

// ─── Reading + listening (§2.1 — one shape, two anchors) ──────────────────

export const progress = pgTable('progress', {
  userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  kind: activityKind('kind').notNull(),
  page: integer('page'),
  positionSeconds: real('position_seconds'),
  percent: real('percent').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.itemId] })])

/**
 * One table, not two (§6). Reading and listening bookmarks differ in exactly
 * one column — the anchor. The check constraint keeps the discriminator honest.
 */
export const bookmarks = pgTable('bookmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  kind: activityKind('kind').notNull(),

  page: integer('page'),                    // reading
  positionSeconds: real('position_seconds'), // listening
  textAnchor: jsonb('text_anchor'),          // {quads, quotedText} — §8.3 recovery

  label: text('label'),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('bookmarks_user_item_idx').on(t.userId, t.itemId),
  check('bookmark_anchor', sql`
    (${t.kind} = 'reading'   AND ${t.page}            IS NOT NULL) OR
    (${t.kind} = 'listening' AND ${t.positionSeconds} IS NOT NULL)
  `),
])

export const journals = pgTable('journals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  bookmarkId: uuid('bookmark_id').references(() => bookmarks.id, { onDelete: 'set null' }),
  kind: activityKind('kind').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('journals_user_item_idx').on(t.userId, t.itemId)])

// ─── Reviews (§10 — assumption A1) ────────────────────────────────────────

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  body: text('body'),
  status: reviewStatus('status').notNull().default('pending'),
  moderatedBy: uuid('moderated_by').references(() => profiles.id, { onDelete: 'set null' }),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('reviews_one_per_user_item').on(t.userId, t.itemId),
  check('review_rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
])

/** A published review returns to the queue when someone reports it (§10.2). */
export const reviewReports = pgTable('review_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id').notNull().references(() => reviews.id, { onDelete: 'cascade' }),
  reporterId: uuid('reporter_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('review_reports_one_per_reporter').on(t.reviewId, t.reporterId)])

// ─── Abuse signal (§11) ───────────────────────────────────────────────────

export const downloadEvents = pgTable('download_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  ipHash: text('ip_hash'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('download_events_user_time_idx').on(t.userId, t.createdAt)])
