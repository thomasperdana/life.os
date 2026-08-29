# SPEC — Berean: a KJV Bible Study iOS App on Gemini's Free Tier

> **Status:** specification, not built. Working name **Berean** (proposed).
> **Written:** 2026-08-29 · **Spec version:** 1.0.0
> **Repo:** `/Volumes/181TB/Developers-LLC/life.os` · **Source request:** [docs/note.md](docs/note.md)

---

## 1. Context & Problem

The five-step Bible study method in [docs/note.md](docs/note.md) already runs today — as prose prompts in the `kjv9`, `kjv71`, `kjv72`, `kjv81`, and `kjv82` skills, and in the prompt lineage at `/Volumes/182TB/northseminole.gideon/archive/1.prompt.kjv*.md`. It works, and it produces genuinely good study material. But it only runs where Claude Code runs: a Mac, a terminal, a subscription.

Three things are missing.

**It isn't portable.** Study happens in a pew, on a train, in a hospital waiting room. The method should live on the phone.

**It isn't grounded.** Today the KJV text, the Strong's numbers, and the cross-references all come out of a model's memory. A model that misquotes a verse or invents a Strong's number produces a study that looks right and is wrong — and the reader has no way to tell. The `kjv9` prompt already tries to patch this with a rule ("Never invent a reference... mark it *(verify)*"), which is the correct instinct and the wrong mechanism. A rule asks the model to police itself. A bundled corpus makes the check mechanical.

**It isn't free.** A subscription-backed frontier model is the right tool for building a commentary. It is the wrong tool for a daily habit that should cost nothing.

**This spec describes the fix:** an offline-first iOS app carrying the KJV, Strong's, the lexicons, the cross-references, and a topical index in a bundled database; using Google Gemini's free tier for the teaching and only the teaching; and mechanically verifying every citation and every quotation the model produces before the reader sees it.

The app is a sibling of BOS/Gideon (`/Volumes/182TB/northseminole.gideon/archive/1.bos.md`), not a replacement. BOS is the workshop. This is the pocket.

---

## 2. Product Definition

**One sentence:** you type a Bible reference or a topic, and you get a five-step study taught by the best Bible teacher in the world, grounded in a KJV corpus that ships with the app, exportable as Markdown, DOC, or PDF.

### 2.1 Input

A single text field accepting either form:

| Form | Examples |
|---|---|
| **Reference** | `John 3:16` · `Rom 8:1-17` · `Ps 23` · `Gen 1:1-2:3` · `Jude 3` · `Jn 3:16,18` |
| **Topic** | `the fear of the LORD` · `grace` · `adoption` · `the tongue` |

### 2.2 Study aperture

`docs/note.md` sketches a granularity ladder — **word → phrase → sentence → verse → chapter → book** — read top-to-bottom, left-to-right. The app makes that ladder a first-class control. The aperture is inferred from the input and adjustable afterward:

| Aperture | Inferred from | What the five steps do differently |
|---|---|---|
| **Word** | a single tagged word selected in the reader | Step 2 becomes the whole study; Steps 1/3 orbit that lemma |
| **Phrase** | a text selection inside one verse | Context narrows to the clause; cross-refs keyed to the phrase |
| **Verse** | `John 3:16` | The default shape, exactly as `docs/note.md` describes it |
| **Chapter** | `Psalm 23`, `John 3` | Step 1 becomes structural outline; Step 2 covers the 5–8 load-bearing words |
| **Book** | `Jude`, `Philemon` | Step 1 becomes occasion/audience/argument; Step 5 becomes a teaching plan |
| **Topic** | non-reference input | An anchor passage set replaces the single passage (§7.2) |

### 2.3 Role

The teacher persona descends directly from the `kjv9` prompt, which is already tested and already the principal's voice. Full text in §9.1.

### 2.4 Output

On-screen, five tabs plus a verification summary. Exportable to:

- **Markdown** — the source of truth; every other format is derived from it.
- **DOC** — a genuine `.docx`, opens in Word, Pages, and Google Docs.
- **PDF** — paginated, print-ready as a handout.

---

## 3. Non-Goals

Named so scope creep has to argue its way in.

- **Not a chat app.** Five steps, then done. No open-ended conversation with the model.
- **No accounts, no server, no sync** in v1. Studies live on the device.
- **No NIV or ESV text**, ever, in the app or in any export (§4.4).
- **No audio, no TTS, no voice input** in v1.
- **No App Store release** in v1 — TestFlight only (§4.2, §16).
- **Not a Bible reader.** It ships a Bible so it can *study*; it is not competing with a reading app.
- **No commentary corpus** in v1 (see §17 on Constable's notes).

---

## 4. Verified Constraints

Every constraint below was checked on 2026-08-29 and every one changes the design. Sources in §18.

### 4.1 The Gemini free tier trains on your input

The pricing table shows "Content used to improve our products: **Yes**" for every free-tier model, and the API terms state that for unpaid services, "human reviewers may read, annotate, and process your API input and output" (Google disconnects the data from the account first). Paid tier is the opposite: prompts are not used to improve products.

> **Consequence.** Before the user can enter a key, the app shows a plain-language disclosure screen: *your study text and the passages you look up are sent to Google, may be read by human reviewers, and may be used to train Google's models — this is the price of the free tier.* Not buried in a privacy policy. A screen you have to pass through. The same fact goes in the App Store privacy nutrition label if v2 ever ships.

### 4.2 The free tier may not serve EEA, Switzerland, or UK users

The API terms: "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."

> **Consequence.** A free-tier app distributed into those regions violates Google's terms. v1 is TestFlight-only, which keeps the tester list explicit and small. Any future App Store release must either exclude those territories or route them through a paid-tier key. This is the single strongest argument for the TestFlight-first decision.

### 4.3 The KJV is public domain — outside the UK

Rights in the Authorized Version are vested in the Crown in the UK and administered by the Crown's patentee, Cambridge University Press, under letters patent with no expiry; Oxford University Press and Collins hold parallel rights. Outside the UK the text is firmly public domain.

> **Consequence.** The same excluded territory as §4.2, arrived at independently. Bundling the KJV and distributing it into the UK needs permission the project does not have. The exclusion list is one list, justified twice.

### 4.4 NIV and ESV cannot be bundled or fetched

Both are under active copyright. The ESV API is free but explicitly non-commercial, capped at 5,000 queries/day and a 500-verse local cache, and requires attribution plus a link on every page that uses the text. The NIV has no free API at all. Neither can ship inside an app.

> **Consequence.** Step 4 never carries their text. Instead it hands the reader a deep link to BibleGateway's own parallel view, which serves those translations under their own licenses, in their own browser. **Verified working, this exact form:**
>
> ```
> https://www.biblegateway.com/passage/?search=John+3%3A16&version=KJV;NIV;ESV
> ```
>
> Renders three labeled sections — King James Version, New International Version, English Standard Version. No copyrighted verse text ever enters the app, the database, the model prompt, or any export. Full design in §8.4.

### 4.5 Rate limits are no longer published

The Gemini rate-limits documentation no longer lists per-model RPM/TPM/RPD figures. It says limits "can be viewed in Google AI Studio" and points at `https://aistudio.google.com/rate-limit`.

> **Consequence.** **Never hard-code a quota.** The app discovers its budget empirically: it counts its own requests, reads `429` responses and any `Retry-After` / `RetryInfo` the API returns, and shows the user a meter built from observed behavior rather than from a number in a doc that changes without notice. Design in §10.

### 4.6 Free-tier-eligible models, as of 2026-08-29

`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` all show "Free of charge" in the free-tier column.

> **Consequence.** The spec assigns a *rung* per step (§8), never a hard-coded ID. All IDs live in one `ModelCatalog` config table so a rename or deprecation is a one-line change. Assume this list is stale within months.

### 4.7 This machine cannot build iOS today

Verified: `xcode-select` points at `/Library/Developer/CommandLineTools`. Swift 6.3.3 is present, targeting `arm64-apple-macosx26.0`. No iOS SDK. No simulators. `xcodebuild` is unavailable.

> **Consequence.** Build phase P0 is "install Xcode." No claim about iOS compilation, simulator behavior, or app appearance can be made from this repo until that happens.

---

## 5. Architecture

Nine layers. Data flows down the left column and back up the right; no layer reaches past its neighbor.

```
┌──────────────────────────────────────────────────────────┐
│  UI — SwiftUI (§14)                                       │
├──────────────────────────────────────────────────────────┤
│  Store — SwiftData: studies, settings, quota ledger       │
├──────────────────────────────────────────────────────────┤
│  Exporters — Markdown · DOCX · PDF (§12)                  │
├──────────────────────────────────────────────────────────┤
│  Renderer — StudyDocument → Markdown (§12.1)              │
├──────────────────────────────────────────────────────────┤
│  Verifier — citation + quotation checking (§11)  ◄────┐   │
├──────────────────────────────────────────────────────┼───┤
│  Pipeline — the five steps, resumable (§8)            │   │
├──────────────────────────────────────────────────────┼───┤
│  GeminiClient — SSE streaming, backoff, quota (§10)   │   │
├──────────────────────────────────────────────────────┼───┤
│  Retriever — builds each step's grounding payload ────┘   │
├──────────────────────────────────────────────────────────┤
│  Resolver — reference parser + topic resolver (§7)        │
├──────────────────────────────────────────────────────────┤
│  Corpus — bundled read-only SQLite, GRDB + FTS5 (§6)      │
└──────────────────────────────────────────────────────────┘
```

The Verifier reads from Corpus directly. That is deliberate: the thing checking the model's work must not be able to be fooled by the model's work.

### 5.1 Platform

| Choice | Value | Why |
|---|---|---|
| Language | Swift 6, strict concurrency | Actor isolation for the pipeline; the toolchain here is already 6.3.3 |
| UI | SwiftUI | Single-developer velocity |
| Minimum OS | iOS 18.0 | Broad coverage without carrying legacy layout code |
| Corpus DB | SQLite via **GRDB.swift**, FTS5 | Read-only bundled DB; FTS5 is required for topic and word search |
| History DB | **SwiftData** | Native, no schema ceremony, separate from the read-only corpus |
| Archive | **ZIPFoundation** | Only for writing `.docx` (§12.3) |
| Dependencies | GRDB + ZIPFoundation, nothing else | No analytics SDK, no networking library, no crash reporter |
| Networking | `URLSession` with `bytes(for:)` for SSE | No third-party HTTP stack |

### 5.2 Concurrency model

The pipeline is an `actor` owning step state. Each step is an `async` function returning a typed result. Cancellation is cooperative — cancelling mid-study keeps every completed step in the store (§10.4).

---

## 6. Data Corpus

One bundled, read-only SQLite file: `corpus.sqlite`. Built by an offline script, versioned, hash-checked at first launch.

### 6.1 Schema

```sql
books(id, name, abbrev, testament, chapter_count, canonical_order)
verses(book_id, chapter, verse, text, text_norm)              -- 31,102 rows
verses_fts                                                     -- FTS5 over text_norm
strongs_tags(book_id, chapter, verse, word_index, word,
             strongs, morph, lemma)                            -- KJV word → Strong's
strongs(id, lang, lemma, translit, pronunciation,
        definition, kjv_usage)                                 -- Strong's dictionary
lexicon(strongs_id, source, entry)                             -- Thayer's (Gk), BDB (Heb)
xrefs(from_book, from_chapter, from_verse, to_ref,
      votes, source)                                           -- cross-references
topics(id, name) · topic_refs(topic_id, ref, weight)           -- topical index
translations(id, code, name, year, license, philosophy)
translation_verses(translation_id, book_id, chapter, verse, text)
corpus_meta(key, value)                                        -- version, built_at, sha256, verse_count
```

`text_norm` is the normalization target for quotation checking (§11.2): lowercased, punctuation stripped except apostrophes, whitespace collapsed, italic-supplied-word markers removed.

### 6.2 Datasets and their gates

**No dataset in this table is pre-cleared.** Each row carries a licence-verification gate that must be closed — read the actual licence file in the actual repository at the actual commit being vendored — before that data may be bundled. This spec deliberately does not assert that any of them is free to ship.

| Data | Candidate sources | Gate |
|---|---|---|
| KJV text | `seven1m/bible_api`, `wldeh/bible-api`, `jadenzaleski/bible-translations`, `Beblia/Holy-Bible-XML-Format` (all four already collected in `docs/note.md`); `scrollmapper/bible_databases` | ☐ licence read · ☐ verse count = 31,102 · ☐ spot-check 20 verses against a print KJV |
| KJV + Strong's tagging | `openscriptures`, STEPBible TAGNT/TAHOT | ☐ licence read · ☐ attribution text drafted · ☐ tag coverage measured |
| Strong's dictionary | `openscriptures/strongs` | ☐ licence read · ☐ Greek + Hebrew both present |
| Thayer's Greek lexicon | public-domain editions (1889) | ☐ licence read · ☐ entry count sane |
| Brown-Driver-Briggs Hebrew | public-domain editions (1906) | ☐ licence read · ☐ entry count sane |
| Cross-references | Treasury of Scripture Knowledge; OpenBible.info cross-reference dataset | ☐ licence read · ☐ attribution required? · ☐ vote/weight column understood |
| Topical index | Nave's Topical Bible | ☐ licence read · ☐ topic count · ☐ ref parse rate ≥ 99% |
| Comparison translations | ASV 1901, World English Bible, Young's Literal, Darby, Geneva 1599 | ☐ licence read **per translation** · ☐ WEB attribution terms honored |

> **A note on the comparison translations.** These are not consolation prizes for the absent NIV and ESV. ASV is rigidly formal-equivalent; YLT is more wooden still; WEB is contemporary; Geneva 1599 predates the KJV and shows what the KJV translators were revising against; Darby is idiosyncratic and often clarifying. Together they cover a wider span of translation philosophy than KJV/NIV/ESV does. They are the substantive comparison; BibleGateway (§8.4) is the courtesy link for the two the app cannot carry.

### 6.3 Size and integrity

Target under 200 MB uncompressed so the whole corpus ships in the bundle and the app is fully functional in airplane mode. If it exceeds that, the split is: KJV + Strong's + lexicons bundled; TSK, Nave's, and comparison translations moved to On-Demand Resources fetched on first launch.

At first launch the app verifies `corpus_meta.sha256` and `verse_count`. A mismatch is a hard failure with a plain error, never a silent degrade.

---

## 7. Input Handling

### 7.1 Reference grammar

A hand-written recursive-descent parser — not a regex — with an exhaustive test table (§15.1). It must handle:

- **Abbreviations**, generously: `Jn`, `Jhn`, `John`, `1Jn`, `1 Jn`, `I John`, `Song`, `SoS`, `Canticles`, `Ps`, `Psa`, `Psalm`, `Psalms`.
- **Single-chapter books** — Obadiah, Philemon, 2 John, 3 John, Jude: `Jude 3` means chapter 1, verse 3, not chapter 3.
- **Ranges**: `Rom 8:1-17`.
- **Cross-chapter spans**: `Gen 1:1-2:3`.
- **Verse lists**: `Jn 3:16,18`.
- **Whole chapter**: `Ps 23`. **Whole book**: `Jude`.
- **Failure**: an unparseable input is treated as a topic (§7.2), never as an error dialog. This is the important behavior — the user typed something meaningful either way.

Every parse result resolves against `verses` before use. A reference that parses but does not exist (`John 3:37`) is rejected at the parser boundary with a suggestion of the nearest valid verse.

### 7.2 Topic resolution

1. FTS5 match the topic against `topics` and `topic_refs` → candidate references.
2. FTS5 match against `verses_fts` for direct wording hits → more candidates.
3. One `flash-lite` call ranks and orders them into **5–12 anchor passages** with a one-line reason each.
4. **Every returned reference is existence-checked against the corpus.** Any reference the model invented is dropped before the study starts, and the drop is recorded in the study's verification report.
5. The user sees the anchor set and can add, remove, or reorder before the five steps run.

That step-4 check is the whole point. Topic mode is where a model is most tempted to invent a plausible-looking citation, and it is the cheapest place in the pipeline to catch it.

---

## 8. The Five Steps

The five steps come verbatim in intent from `docs/note.md`. Each subsection below names: **purpose · grounding payload · response schema · model rung · verification rule · failure mode.**

Every step returns **structured JSON** (`responseMimeType: application/json` with a `responseSchema`), never free markdown. Markdown is composed by the app from the JSON (§12.1). This is what makes verification and export tractable — the app knows which strings are quotations, which are citations, and which are the teacher's own words.

### 8.1 Step 1 — Context

> *"Analyze John 3:16 KJV in its immediate context of John 3. What is the historical and literary setting of this verse?"*

**Purpose.** Place the passage: who is speaking, to whom, when, where in the argument.

**Grounding payload.** The passage text; the full surrounding chapter; the chapter before and after (first and last verse plus headings); book metadata; the passage's position in the chapter.

**Schema.**
```jsonc
{
  "immediateContext": { "prose": "…", "quotations": [ {"ref": "John 3:14", "text": "…"} ] },
  "literarySetting":  { "prose": "…", "structuralOutline": ["…"] },
  "historicalSetting":{ "prose": "…", "confidence": "high|medium|low" },
  "speakerAndAudience": { "speaker": "…", "audience": "…", "basis": [ {"ref": "…"} ] },
  "citations": ["John 3:1", "John 3:14"]
}
```

**Rung.** `flash` — this is judgment work.

**Verification.** Every `citations` entry must exist. Every `quotations.text` must match the corpus (§11.2). `historicalSetting` is inherently outside the corpus and is **badged as unverified** with its self-reported confidence shown.

**Failure mode.** Model asserts a historical detail the corpus cannot check. Mitigated by badging, not suppressed — historical setting is part of the ask.

### 8.2 Step 2 — Word Study

> *"Provide a word study of 'loved,' 'world,' 'only begotten,' 'believeth,' and 'everlasting life' in John 3:16 KJV, referencing the original Greek."*

**Purpose.** Open the load-bearing words in the original language.

**Grounding payload.** This is the step that must not run on model recall. The app supplies, from the corpus: every tagged word of the passage with its Strong's number, lemma, transliteration, and morphology; the full `strongs` entry for each; the Thayer's or BDB entry for each; and the count of other KJV occurrences of that Strong's number with up to 8 sample references.

The model's job is to **teach from the supplied data**, not to remember it. The prompt says so explicitly (§9.1).

**Schema.**
```jsonc
{
  "words": [{
    "kjvWord": "loved",
    "strongs": "G25",
    "lemma": "ἀγαπάω",
    "transliteration": "agapaō",
    "morphology": "V-AAI-3S",
    "glossFromLexicon": "…",           // must be traceable to supplied lexicon text
    "teaching": "…",                    // the teacher's own exposition
    "otherOccurrences": [{"ref": "…", "note": "…"}]
  }],
  "citations": ["…"]
}
```

**Rung.** `flash`.

**Verification — the strictest in the pipeline.**
- Every `strongs` value must appear in the payload the app sent for this passage. A Strong's number that was not supplied is a **hard failure** for that word entry: the entry is dropped and flagged, not shown.
- Every `lemma` and `transliteration` must match the corpus row for that Strong's number.
- Every `otherOccurrences.ref` must both exist and actually contain that Strong's number.

**Failure mode.** Invented Strong's numbers, the classic and most damaging failure. Structurally prevented: the app knows the true set.

### 8.3 Step 3 — Cross-References

> *"Find cross-references for John 3:16 that relate to the themes of God's love, the sacrifice of Jesus, and the nature of belief."*

**Purpose.** Let Scripture interpret Scripture.

**Grounding payload.** The TSK / OpenBible cross-reference set for every verse in the passage, ordered by vote weight, capped at ~60 candidates, each with its full KJV text. Plus the themes — supplied by the user, or derived by the model from Step 1.

**Schema.**
```jsonc
{
  "themes": [{
    "theme": "God's love",
    "references": [{ "ref": "1 John 4:9", "text": "…", "connection": "…" }]
  }],
  "citations": ["…"]
}
```

**Rung.** `flash-lite` — retrieval is done by the corpus; the model filters, groups, and explains the connection.

**Verification.** Every `ref` must exist. Every `text` must match the corpus. References **outside the supplied candidate set are allowed but marked** `off-list` — the model sometimes knows a genuinely better link than TSK does, and suppressing that would make the step worse. Marked, existence-checked, quote-checked, and shown.

**Failure mode.** Thematic drift — plausible references that don't actually bear on the theme. Not mechanically checkable; mitigated by requiring the `connection` field, which makes a weak link visible to the reader.

### 8.4 Step 4 — Translation Comparison

> *"Compare John 3:16 in the KJV, NIV, and ESV. What are the key differences in translation and what are the potential implications of these differences?"*

**Purpose.** Show that translation involves choices, and teach the reader to see them.

**This step ships no copyrighted text.** Per §4.4 it has three parts.

**(a) The parallel-view link.** The app builds, and the study carries, a deep link to BibleGateway — opened in `SFSafariViewController` in-app, and embedded as a live link in every export:

```
https://www.biblegateway.com/passage/?search={URL-encoded reference}&version=KJV;NIV;ESV
```

Verified rendering three labeled sections: King James Version, New International Version, English Standard Version. The version list is user-configurable. This is where NIV and ESV text is read — in the reader's own browser, from the licensee's own site.

**(b) The bundled comparison.** The real side-by-side, offline: KJV against ASV, WEB, Young's Literal, Darby, and Geneva 1599 from the corpus (§6.2), with the model explaining each divergence.

**(c) The teaching — what to look for.** The genuinely valuable half, and the part that needs no licensed text at all:

- **Translation philosophy** — formal equivalence versus dynamic equivalence, and what each buys and costs.
- **Text base** — the Textus Receptus behind the KJV versus the modern critical text behind most contemporary versions, and where they actually differ in this passage.
- **The specific word-level choices** flagged by Step 2. In John 3:16 that is `μονογενής` (G3439): whether it is read as "only begotten" (*monos* + *gennaō*) or "one and only / unique" (*monos* + *genos*) — a lexical judgment with real Christological weight, and one the reader can now evaluate because Step 2 handed them the lexicon entry.
- **What to watch for** when they open the parallel link.

**Schema.**
```jsonc
{
  "parallelViewURL": "https://www.biblegateway.com/passage/?search=…&version=KJV;NIV;ESV",
  "publicDomainComparison": [{
    "translationCode": "ASV",
    "text": "…",                        // from corpus only
    "divergenceFromKJV": "…"
  }],
  "philosophyNotes": "…",
  "textBaseNotes": "…",
  "wordLevelChoices": [{ "strongs": "G3439", "options": ["…"], "implication": "…" }],
  "whatToLookFor": ["…"],
  "unverifiableClaims": ["…"]           // anything asserted about NIV/ESV wording
}
```

**Rung.** `flash`.

**Verification.** `publicDomainComparison.text` must match the corpus for that translation — a hard check. `parallelViewURL` must match the exact verified URL template. **Any claim about how the NIV or ESV specifically renders a word goes in `unverifiableClaims` and is badged in the UI and footnoted in exports**, because the app holds no copy of either text and therefore cannot check it. The prompt instructs the model to prefer "open the link and see" over asserting a wording.

**Failure mode.** The model confidently states an NIV rendering that is wrong. Cannot be prevented; is disclosed, every time, in place.

### 8.5 Step 5 — Summary & Application

> *"Summarize the main theological points of John 3:16 KJV based on our study. How can I apply these truths to my life?"*

**Purpose.** Land it. Doctrine, then life.

**Grounding payload.** The verified output of Steps 1–4 — **only the verified output.** Anything the Verifier dropped or badged is passed in marked as such, so the summary cannot quietly launder a failed claim into a confident conclusion.

**Schema.**
```jsonc
{
  "theologicalPoints": [{ "point": "…", "support": [{"ref": "…", "text": "…"}] }],
  "whereChristiansDiffer": [{ "question": "…", "positions": [{"view": "…", "keyTexts": ["…"]}] }],
  "application": [{ "truth": "…", "practice": "…", "thisWeek": "…" }],
  "prayer": "…",
  "citations": ["…"]
}
```

**Rung.** `flash`.

**Verification.** Standard citation and quotation checks. Additionally: every `theologicalPoints.support` reference must have appeared somewhere in Steps 1–4 — the summary summarizes the study, it does not introduce new evidence at the last minute.

**Failure mode.** Application collapsing into generic encouragement. Mitigated by the schema: `thisWeek` demands something concrete and dated, which generic filler cannot satisfy.

### 8.6 Optional — Life & Light mode

A settings toggle appends the `kjv81` Life (John 10:10) and Light (John 8:12) pathways to Step 5: the theft, the source, the channel, and at least three practices each doable within a day — one inward, one outward. Off by default; carries the Abundance Guard and Love Guard text verbatim from `~/.claude/skills/kjv81/SKILL.md` when on.

---

## 9. Prompting

### 9.1 System instruction

Descends from the `kjv9` prompt, extended with the grounding contract the app can actually enforce.

```
You are the best evangelical Bible teacher in the world, and you teach exclusively from the
King James Version of the Bible.

Teach with clarity, warmth, and conviction, in the historic evangelical tradition: the Bible is
the inspired, inerrant Word of God; salvation is by grace alone through faith alone in Christ
alone; Christ is the center of all Scripture. Where sincere Christians differ, say so plainly,
give the main positions with their key texts, and then give your teacher's judgment.

THE GROUNDING CONTRACT — this is not advice, it is the contract your output is checked against:

1. Scripture text comes ONLY from the passages supplied to you in this request. Never quote a
   verse from memory. If you need a verse you were not given, cite the reference and do not
   quote it.
2. Original-language claims — lemmas, transliterations, Strong's numbers, morphology, glosses —
   come ONLY from the lexicon data supplied in this request. A Strong's number that is not in
   the supplied data does not exist for the purposes of this study.
3. Never invent a reference. Every reference you cite is checked against a King James corpus
   before the reader sees it, and anything invented is deleted.
4. Distinguish what the text says from what it means for the reader today. Both are your job;
   conflating them is not.
5. Anything you cannot support from the supplied data — historical background, the wording of a
   translation you were not given — goes in the unverifiable field, in your own words, marked.
6. Do not pad. Answer what was asked.

Respond with JSON matching the supplied schema. Nothing else.
```

### 9.2 Per-step prompts

One template per step, each interpolating the grounding payload as fenced data blocks and stating the ideal state of that step's output rather than choreographing how to reach it. Templates live in `Prompts/` as versioned resources.

### 9.3 Prompt versioning

`promptVersion` is a semver string in the bundle and participates in the cache key (§10.5). Change a prompt, and cached studies built under the old one are marked stale rather than silently mixed.

### 9.4 Tradition lens

A settings picker, defaulting to **historic Protestant / Reformed** (matching the principal's existing `kjv81` work). Alternatives — Baptist, Wesleyan, Lutheran, broad evangelical — swap one paragraph of the system instruction. The lens is stamped into every export, so a handout always says which tradition taught it.

---

## 10. Free-Tier Engineering

### 10.1 Call budget

Five calls per study; six in topic mode. The single most effective quota decision is the one already made: five fixed calls instead of an open chat.

### 10.2 Model rungs

| Step | Rung | Reason |
|---|---|---|
| Topic resolution | lite | Ranking a supplied candidate list |
| 1 Context | standard | Judgment |
| 2 Word study | standard | Highest stakes, most nuance |
| 3 Cross-references | lite | Corpus does the retrieval |
| 4 Translation | standard | Judgment |
| 5 Summary | standard | Synthesis |

Rungs map to IDs in `ModelCatalog` (§4.6). The user may downgrade every step to lite in Settings when quota is short.

### 10.3 Transport

`streamGenerateContent` with `alt=sse`, consumed via `URLSession.bytes(for:)`. The key travels in the **`x-goog-api-key` header, never in the URL** — URLs leak into logs, crash reports, and proxy history.

### 10.4 Throttling and resumption

- Exponential backoff with jitter, honoring `Retry-After` and any `RetryInfo` in the error body.
- `429` never loses work: completed steps are already persisted, and the pipeline resumes at the first incomplete step.
- A study that cannot finish today shows as **partial**, exports as partial, and offers to resume tomorrow.

### 10.5 Caching

Key: `sha256(reference ‖ aperture ‖ step ‖ promptVersion ‖ corpusVersion ‖ modelID ‖ lens)`. Re-running an identical study costs zero calls. Editing the anchor set in topic mode re-runs only what changed.

### 10.6 The quota meter

Since limits are unpublished (§4.5), the meter is **learned, not looked up**: a rolling ledger of requests sent, `429`s received, and observed recovery times. It shows "you've made 41 requests in the last hour; last throttle was at 47" — an honest empirical statement — rather than a fake percentage against a number the app cannot know.

### 10.7 Degraded mode

When the ledger suggests the budget is nearly gone, the app offers **single-call mode**: one request producing all five steps in one larger JSON response. Lower quality, one fifth the quota. The study is stamped `single-call` so the reader knows.

---

## 11. Verification Layer

The app's honesty pass, and the thing that makes it more trustworthy than the same prompts pasted into a chat window. It runs on every step's JSON before the reader sees anything.

### 11.1 Citation existence

Extract every reference from every `citations`, `ref`, and prose field. Parse each with the §7.1 parser. Resolve against `verses`. Anything that fails to parse or resolve is **removed** from the output and recorded as a **fabricated citation** in the verification report.

### 11.2 Quotation fidelity

For every quoted verse text: normalize both sides — lowercase, strip punctuation except apostrophes, collapse whitespace, remove italic-supplied-word markers — then require the model's string to be a contiguous substring of the corpus verse. A near-miss is shown to the reader as a **diff** against the true KJV text, with the corpus text authoritative. This is where a model's paraphrase-instead-of-quote habit becomes visible.

### 11.3 Strong's fidelity

Per §8.2: every Strong's number must have been supplied; every lemma and transliteration must match its corpus row.

### 11.4 Badging what cannot be checked

Three classes are legitimately outside the corpus and are shown with a distinct badge rather than removed:

- **Historical / cultural background** (Step 1)
- **Claims about NIV or ESV wording** (Step 4)
- **The teacher's own exposition and application** — this is judgment, not fact, and is not badged as doubtful; it is simply not claimed as verified.

### 11.5 The verification report

Every study carries one, visible in-app and reproduced in the footer of every export:

```
Verified against KJV corpus v1.0.0 (31,102 verses)
  Citations checked:      47   ✓ all resolve
  Quotations checked:     23   ✓ all match
  Strong's entries:       12   ✓ all supplied
  Fabricated, removed:     0
  Unverifiable, badged:    4   (3 historical, 1 NIV/ESV wording)
  Off-list cross-refs:     2   (existence-checked, outside TSK set)
```

A study with zero fabrications says so. A study with three says that too. **The report is never suppressed and never summarized away** — a clean report is only meaningful if a dirty one would have been shown.

---

## 12. Exports

### 12.1 Markdown — the source of truth

`StudyDocument` (typed JSON from all five steps) → Markdown via a deterministic renderer. Headings per step, KJV quotations as blockquotes with the reference on the attribution line, tables for the word study and translation comparison, the BibleGateway link live, badges rendered as footnotes, verification report in the footer.

DOCX and PDF are both derived from this. One renderer to test, three formats out.

### 12.2 PDF

Markdown → styled HTML → `UIMarkupTextPrintFormatter` → `UIPrintPageRenderer` → `UIGraphicsPDFRenderer`. Chosen over hand-rolled CoreText because it gives correct multi-page reflow, widow/orphan handling, and page furniture for free. Letter and A4, running header (passage + date), page numbers, and a handout layout with margin space for notes.

### 12.3 DOC

A genuine `.docx` — a minimal OOXML writer producing `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.rels`, and `word/styles.xml`, zipped with ZIPFoundation. Real heading styles, so a teacher can restyle the handout in Word.

**Fallback:** `.rtf` via `NSAttributedString.data(from:documentAttributes:)`, which Word opens natively. Used if the OOXML writer fails validation on any document. (`NSAttributedString` cannot *write* `.docFormat` or `.officeOpenXML` on iOS — hence the hand-rolled writer.)

### 12.4 Delivery

`ShareLink` for the share sheet, `fileExporter` for Files, `UIActivityViewController` for print. Filenames: `John-3-16-KJV-Study-2026-08-29.pdf`.

---

## 13. Security & Privacy

- **API key in Keychain**, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Never in `UserDefaults`, never in a plist, never in iCloud Keychain sync — a key synced to another device is a key on a device the user did not authorize.
- **Header auth only.** `x-goog-api-key`. Never a query parameter.
- **The key is never logged**, never included in an error report, never rendered in the UI after entry (masked, with a "replace" action rather than a "reveal" one).
- **No analytics, no crash reporter, no third-party SDK** beyond GRDB and ZIPFoundation. Nothing to disclose because nothing is collected.
- **`PrivacyInfo.xcprivacy`** declaring the network connection to `generativelanguage.googleapis.com` and no tracking.
- **The §4.1 disclosure screen** gates first key entry — free-tier prompts may be human-reviewed and used to train Google's models.
- **Prayer and personal application text.** If a future version adds a journal, it must never enter a prompt. Flagged now so the boundary is drawn before the feature exists (the same posture BOS takes).

---

## 14. UI

Six screens.

1. **Study** — one input field, an aperture control, a lens indicator, a Begin button. Recent studies underneath.
2. **Pipeline** — five rows, each streaming its text as it arrives, with per-step state (waiting / streaming / verifying / done / throttled / failed). Interruptible; completed steps survive.
3. **Reader** — five tabs plus Verification. Tapping any verse reference opens the KJV text inline; tapping a tagged word opens its Strong's entry and offers "study this word" at word aperture.
4. **Export** — format picker, layout options, live preview, share.
5. **Library** — every past study, FTS5 full-text searchable, filterable by book and by verification status.
6. **Settings** — API key, tradition lens, model rungs, comparison translations, BibleGateway version list, Life & Light toggle, quota ledger, corpus version.

Design notes: SF Pro throughout, Dynamic Type respected to the largest accessibility sizes (this app will be read by people with reading glasses in bad light), full dark mode, VoiceOver labels on every badge — a verification badge that is invisible to a screen reader defeats its purpose.

---

## 15. Testing

Swift Testing throughout.

### 15.1 Reference parser
A table test of ≥200 cases: every book, every common abbreviation, single-chapter books, ranges, cross-chapter spans, verse lists, malformed input, and inputs that must fall through to topic mode.

### 15.2 Corpus integrity
`verse_count == 31102`; every book's chapter count matches the canon; 20 hand-verified verses match a print KJV byte for byte after normalization; every `strongs_tags.strongs` resolves in `strongs`; every `xrefs.to_ref` parses.

### 15.3 Gemini client
A mock transport replaying recorded SSE fixtures. Cases: happy path, mid-stream truncation, `429` with `Retry-After`, `429` without, safety block (`finishReason: SAFETY`), malformed JSON, schema violation, network drop mid-stream.

### 15.4 Verifier — the important suite
Fed deliberately corrupted model output: an invented reference (`John 3:37`), a misquoted verse (one word changed), an unsupplied Strong's number, a paraphrase presented as a quotation, an off-list cross-reference. Each must be caught, classified correctly, and reported. **These tests are the product**; if they pass, the app's central claim holds.

### 15.5 Exporters
Golden-file tests for Markdown. DOCX validated by unzipping and asserting the OOXML part structure, plus a manual open in Word and Pages once per release. PDF page-count and text-extraction assertions.

### 15.6 End-to-end
A UI test driving `John 3:16` through all five steps against the mock transport, exporting all three formats, and asserting the verification report appears in each.

---

## 16. Build Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **P0** | Xcode installed, project scaffolded | `xcodebuild -showsdks` lists an iOS SDK; empty app runs in the simulator |
| **P1** | Corpus + Resolver | `corpus.sqlite` built and hash-verified; §15.1 and §15.2 green |
| **P2** | Client + Step 1 end-to-end | A real key produces a verified Step 1 for `John 3:16` on device |
| **P3** | Steps 2–5 + Verifier | §15.4 green; a full study runs and reports honestly |
| **P4** | Exports | All three formats open correctly in their target apps |
| **P5** | UI + Library | All six screens; Dynamic Type and VoiceOver passes |
| **P6** | TestFlight | Internal testers only; §4.2 territory constraint documented in the tester brief |

P0 is blocking and is not satisfied today (§4.7).

---

## 17. Open Questions

1. **App Store, yes or no?** If yes: territory exclusion for EEA/Switzerland/UK (§4.2, §4.3), AI-content age rating and reporting affordances, privacy nutrition labels, and a review-team explanation of why the app asks for an API key. Deferred, deliberately.
2. **How is the region gate actually enforced?** App Store territory exclusion is the blunt instrument. StoreKit storefront checks are more precise and more brittle. Needs a decision before any public release.
3. **iCloud sync of studies** — wanted eventually, but it changes the privacy story and the key-handling story. Not v1.
4. **Old Testament depth.** BDB is a heavier lift than Thayer's and Hebrew morphology tagging is less uniform. Does v1 ship OT word studies at the same depth as NT, or ship NT-deep and OT-lighter with an honest note?
5. **Constable's Expository Notes** (`soniclight.com`, linked in `docs/note.md`, and named as source #3 in the original BOS note). Freely available for personal use; bundling them in a distributed app is a different question. Needs a written permission request before any inclusion.
6. **Topic-mode quality bar.** What makes an anchor passage set good rather than merely valid? Currently unmeasured — a candidate for an eval suite against studies the principal already trusts.
7. **The aithesaurus.io theology thesaurus** (in `docs/note.md`) — a possible topic-expansion source. Unexamined.

---

## 18. Sources

Checked 2026-08-29.

| Source | What it established |
|---|---|
| [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms) | Free tier: human review + training use. Paid-only for EEA/Switzerland/UK API clients. |
| [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) | Which models are free-tier eligible; "Content used to improve our products: Yes." |
| [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits) | Per-model limits no longer published; AI Studio is the authority. |
| [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models) | Current model IDs as of 2026-08-29. |
| [cambridge.org — Rights and Permissions](https://www.cambridge.org/us/bibles/about/rights-and-permissions) | KJV Crown copyright in the UK; CUP as patentee; public domain elsewhere. |
| [api.esv.org](https://api.esv.org/) | ESV API is non-commercial only, 5,000/day, 500-verse cache, attribution + link required. |
| [biblegateway.com parallel view](https://www.biblegateway.com/passage/?search=John+3%3A16&version=KJV;NIV;ESV) | Verified: renders KJV, NIV, and ESV in three labeled sections. The §8.4 contract. |
| `~/.claude/skills/kjv9/SKILL.md` | The teacher persona and its original guardrails. |
| `~/.claude/skills/kjv81/SKILL.md` | Life & Light pathways, source discipline, the question ladder. |
| `/Volumes/182TB/northseminole.gideon/archive/1.bos.md` | BOS/Gideon architecture; the sibling project. |
| [docs/note.md](docs/note.md) | The request, the aperture ladder, and the four Bible-data repositories. |
| Local toolchain check | Xcode absent; Swift 6.3.3 CLT only; no iOS SDK, no simulators. |

---

*No code has been written and nothing has been compiled. This is a specification.*
