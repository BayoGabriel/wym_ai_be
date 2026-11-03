# WymNet Backend — Current Build State (Handoff for Next Phase)

## Purpose

This document describes what is **already implemented** in this repository so a follow-on AI developer can continue from the correct baseline without re-discovering architecture decisions.

It is based on code inspection of `src/`, migrations, tests, and existing project docs.

---

## 1) What this project is right now

- A backend-only **modular monolith** in TypeScript/Express.
- Multi-tenant foundation is in place (organization-scoped data + auth context).
- Core platform modules are implemented for:
  - Auth + JWT + refresh token rotation
  - Organization and user CRUD (with RBAC gates)
  - RBAC role/permission reads
  - Product catalog + organization entitlements
  - Organization settings + assistant config
  - Knowledge management (TEXT + PDF upload)
  - Knowledge processing/chunking
  - Retrieval (deterministic local embedding + cosine ranking)
  - AI response endpoint using provider abstraction (currently local fake provider)
  - Conversation/message persistence with AI reply orchestration and idempotency
  - Audit event recording
- Not yet implemented: customer/lead/appointment modules, escalation workflow, public chat surface (see Section 19).

---

## 2) Tech stack and runtime

- Runtime: Node.js + TypeScript
- HTTP: Express
- Validation: Zod
- DB: PostgreSQL + Drizzle ORM
- Auth crypto: bcrypt + jsonwebtoken
- File/PDF: local filesystem storage + `pdf-parse`
- Security middleware: helmet, cors, rate limit (auth routes)
- Tests: Vitest + Supertest
- Containerization: Docker + docker-compose for local Postgres

Package and scripts are defined in `package.json`:

- dev server, build/start, typecheck/lint/format/test, drizzle generate/migrate/studio, seed.
- Convenience wrappers: `npm run start:dev` (compose up + generate + migrate + seed + dev), `npm run stop:dev` (kill port 3000 + compose down).

---

## 3) Bootstrapping and app wiring

- `src/server.ts` starts HTTP server and handles graceful SIGTERM/SIGINT shutdown.
- `src/app.ts` composes middleware and mounts all route modules.
- Global middleware:
  - `helmet`, `cors`, `express.json()`
  - request logging via `morgan`
  - centralized 404 + error JSON handler
- Base routes:
  - `GET /` service info
  - `GET /api/v1/health` (includes DB up/down check)

---

## 4) Environment and config already implemented

`src/config/env.ts` validates env at startup (throws on invalid config).

Notable configured domains:

- Server/DB: `NODE_ENV`, `PORT`, `DATABASE_URL`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, TTLs, bcrypt rounds
- Knowledge processing: max doc size, max text len, chunk size/overlap
- Retrieval: provider/model/dimensions, topK, minScore
- AI: provider/model/temperature/token/context limits, history window (`AI_HISTORY_MESSAGES`, default 12), fallback message

Provider enums:

- Embedding provider: `LOCAL`
- AI provider: `LOCAL_FAKE` | `GEMINI`
- Gemini-specific: `GEMINI_API_KEY`, `AI_REQUEST_TIMEOUT_MS` (default 30000)

---

## 5) Data model and migrations (implemented tables)

### Phase 0/1/2 core platform tables

- `organizations`
- `users`
- `roles`, `permissions`, `role_permissions`, `user_roles`
- `products`, `organization_products`
- `subscriptions`
- `refresh_tokens`

### Platform support

- `organization_settings`
- `assistant_configurations`
- `audit_events`
- `usage_records`

### Knowledge + retrieval

- `knowledge_items`
- `knowledge_documents`
- `knowledge_chunks`
  - includes embedding fields: `embedding`, `embedding_status`, `embedding_model`, `embedding_dim`, `content_hash`

### Conversations

- `conversations`
  - org-scoped; `status` enum `ACTIVE|CLOSED|ARCHIVED`, `channel` enum `WEB|API`, `external_session_id`, `title`, `metadata` (JSON text), `closed_at`
  - indexes: `(organization_id, created_at)`, `(organization_id, status)`
- `messages`
  - `role` enum `USER|ASSISTANT|SYSTEM`, `content`, `client_request_id` (idempotency), `metadata` (JSON text; stores sources/usage/grounded/model for assistant replies)
  - indexes: `(conversation_id, created_at)`, `(organization_id, created_at)`

Schema is defined in `src/database/schema/core.ts` and materialized by migrations:

- `drizzle/migrations/0000_*.sql` (core identity/platform)
- `drizzle/migrations/0001_*.sql` (settings, assist config, audit, usage, product metadata)
- `drizzle/migrations/0002_*.sql` (knowledge + processing + embedding fields)
- `drizzle/migrations/0003_*.sql` (conversations + messages tables)
- `drizzle/migrations/0004_*.sql` (conversation/message indexes; regenerates the same tables idempotently)

---

## 6) Auth and identity implementation

### Auth features in code

- Register:
  - Creates org + user
  - Assigns default `Client Administrator` role if present
  - Issues access + refresh tokens
- Login with password verification
- Refresh token rotation (hash-stored refresh tokens)
- Logout token revocation
- `GET /auth/me` returns identity + roles + permissions

### Auth middleware

- `authenticate` verifies bearer token and loads:
  - user status
  - role memberships
  - permissions derived through role-permission joins
  - `AuthContext` with `platformAccess` and `organizationId`

### Security notes

- Auth routes have a dedicated rate limiter.
- Password hashes via bcrypt.
- Refresh tokens are stored hashed (SHA-256), not plaintext.

---

## 7) RBAC + authorization implementation

### Implemented primitives

- Permission catalog constant in `modules/rbac/permissions.ts`
- Runtime guards:
  - `requirePermission`
  - `requirePlatform`
  - `requireOrgScope`
- Permission catalog now includes `conversation.read`, `conversation.create`, `conversation.update`, `conversation.message.create` (granted to platform + client roles in seed)

### Implemented RBAC routes

- `GET /api/v1/roles`
- `GET /api/v1/permissions`

These are permission-gated (`role.read`, `permission.read`).

---

## 8) Organizations and users modules

### Organizations (`/api/v1/organizations`)

- List, get, create, update
- Platform users can access all orgs
- Non-platform users are restricted to own org scope

### Organization settings (`/api/v1/organizations/settings`)

- `GET` and `PATCH` for current org only
- Upsert-style behavior (insert if missing, else update)
- Writes audit event `organization.settings.updated`

### Users (`/api/v1/users`)

- List, get, create, update
- Permission-gated (`user.read/create/update`)
- Tenant scoping rules enforced for non-platform users

---

## 9) Products and entitlement foundation

### Admin product routes (`/api/v1/admin`)

- `GET /products` (platform manage)
- `POST /products` create product
- `POST /products/assign` assign product entitlement to org

### Entitlement service

- `organizationHasProduct(organizationId, productCode)` checks:
  - assignment exists and active
  - product exists and active

This entitlement check is reused in Knowledge, Retrieval, and AI routes to gate WymAssist functionality.

---

## 10) Assist configuration module

Routes under `/api/v1/assist`:

- `GET /` current org assistant config
- `PATCH /` partial update/upsert

Fields include assistant name, welcome message, tone, operating details, and enablement flags (escalation/lead capture/appointment requests).
Audit event: `assist.config.updated`.

---

## 11) Knowledge management module (Phase 3)

Routes:

- `GET /api/v1/knowledge`
- `POST /api/v1/knowledge` (TEXT item creation)
- `GET /api/v1/knowledge/:id`
- `PATCH /api/v1/knowledge/:id`
- `DELETE /api/v1/knowledge/:id` (soft archive by setting `ARCHIVED`)
- `POST /api/v1/knowledge/documents` (PDF upload metadata + storage)
- `POST /api/v1/knowledge/:id/process` (processing trigger)

Implemented behavior:

- Strict auth + `knowledge.read`/`knowledge.write` permissions
- WymAssist entitlement requirement
- Tenant isolation via `organization_id` constraints in queries
- List filtering + search + pagination
- PDF validation:
  - MIME must be `application/pdf`
  - max size from env
  - magic header `%PDF-`
- Local storage abstraction for PDF file persistence
- Audit events on create/update/archive/upload/process lifecycle

---

## 12) Processing/chunking pipeline (Phase 4)

Implemented in `modules/knowledge/processing/*`:

- Text normalization (`normalizeText`)
- Deterministic char-based chunking (`chunkText`) with overlap
- PDF text extraction (`pdf-parse`)
- Processor orchestration (`processKnowledgeItem`)

Processing lifecycle:

- `PENDING -> PROCESSING -> COMPLETED`
- failures set `FAILED` + `processing_error`
- old chunks are deleted before reprocessing insert
- per-PDF chunk metadata includes page and filename when available

Endpoint:

- `POST /api/v1/knowledge/:id/process`

Side effect:

- After processing, route triggers embedding generation for pending chunks.

---

## 13) Retrieval module (Phase 5)

### Embeddings

- `EmbeddingProvider` abstraction exists.
- Current implementation: deterministic local simhash-style vectorizer.
- Chunk embeddings stored as JSON text.

### Embedding job function

- `embedMissingForItem` embeds pending chunks for a knowledge item and marks status `COMPLETED`.

### Retrieval service

- `retrieveRelevantKnowledge({ organizationId, query, topK, minScore })`
- Org-scoped and only `knowledge_items.status = ACTIVE`
- Candidate cap (200), cosine scoring in app memory, threshold filter, sorted topK return
- Returns chunk/source evidence structure for AI usage

### Retrieval API

- `POST /api/v1/knowledge/retrieve`
- Requires auth, `knowledge.read`, and WymAssist entitlement

---

## 14) AI module (Phase 6 baseline)

### Provider abstraction

- `LLMProvider` interface + `getLLMProvider()`
- Providers: `LOCAL_FAKE` (deterministic test/dev), `GEMINI` (Google Gemini via `@google/genai` SDK)
- Selection via `AI_PROVIDER` env var; Gemini requires `GEMINI_API_KEY`

### Prompting and grounding

- System prompt with explicit safety/grounding constraints
- Context block built from top retrieval results with char/chunk caps

### AI orchestration

- `generateResponse` flow:
  1. retrieve relevant knowledge (tenant-scoped)
  2. build prompt + context (conversation history block + knowledge block)
  3. call provider
  4. shape response with `grounded`, `sources`, `usage`, `meta`
  5. audit `ai.generate.success`
- Accepts optional `conversationContext.messages` (`user`/`assistant` roles) — trimmed to the last `AI_HISTORY_MESSAGES` entries — and optional `language` hint.
- Used both by `POST /api/v1/ai/respond` and by the conversation message orchestration (Phase 7).

### AI endpoint

- `POST /api/v1/ai/respond`
- Requires auth + `knowledge.read` + WymAssist entitlement
- Body: `{ message, language?, conversationContext? }`
- Failure fallback returns friendly non-crashing response payload

Gemini provider capabilities:

- System instruction + structured conversation history (user/model roles)
- Request timeout via `AbortController` (`AI_REQUEST_TIMEOUT_MS`)
- Usage metadata extraction (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`)
- Safe handling of empty, blocked, or missing responses
- Sanitized error wrapping (`PROVIDER_TIMEOUT`, `PROVIDER_ERROR`) — API keys stripped from error messages
- Model configured via `AI_MODEL` (default `gemini-2.5-flash`)

---

## 15) Audit and usage status

### Audit

- Generic `recordAudit()` service is implemented and used in multiple modules.
- Audit coverage exists for major knowledge/config/product/AI events.

### Usage

- `usage_records` table exists and is written to by the conversation message flow (`eventType: conversation.ai.response`, quantity = total tokens, provider = model).
- No dedicated usage service/module read endpoint is implemented yet.

---

## 16) Seeded platform baseline

`src/scripts/seed.ts` currently seeds:

- Permission records from permission constants (including `conversation.*`)
- Roles:
  - WymNet Super Administrator
  - WymNet Administrator
  - Client Administrator
  - Client Staff
- Products:
  - WYMASSIST
  - WYMINSIGHT
  - WYMFLOW
- Role-permission grants for the above roles (all roles receive the `conversation.*` grants relevant to their scope)

---

## 17) Implemented HTTP surface (quick route map)

- `GET /`
- `GET /api/v1/health`
- Auth:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/auth/me`
- Organizations:
  - `GET /api/v1/organizations`
  - `GET /api/v1/organizations/:id`
  - `POST /api/v1/organizations`
  - `PATCH /api/v1/organizations/:id`
  - `GET /api/v1/organizations/settings`
  - `PATCH /api/v1/organizations/settings`
- Users:
  - `GET /api/v1/users`
  - `GET /api/v1/users/:id`
  - `POST /api/v1/users`
  - `PATCH /api/v1/users/:id`
- RBAC:
  - `GET /api/v1/roles`
  - `GET /api/v1/permissions`
- Assist config:
  - `GET /api/v1/assist`
  - `PATCH /api/v1/assist`
- Product admin:
  - `GET /api/v1/admin/products`
  - `POST /api/v1/admin/products`
  - `POST /api/v1/admin/products/assign`
- Knowledge/RAG:
  - `GET /api/v1/knowledge` (query: `category`, `sourceType`, `status`, `search`, `page`, `limit`)
  - `POST /api/v1/knowledge`
  - `GET /api/v1/knowledge/:id`
  - `PATCH /api/v1/knowledge/:id`
  - `DELETE /api/v1/knowledge/:id`
  - `POST /api/v1/knowledge/documents`
  - `POST /api/v1/knowledge/:id/process`
  - `POST /api/v1/knowledge/retrieve`
- AI:
  - `POST /api/v1/ai/respond`
- Conversations:
  - `POST /api/v1/conversations`
  - `GET /api/v1/conversations` (query: `status`, `page`, `limit`, `order`)
  - `GET /api/v1/conversations/:id`
  - `PATCH /api/v1/conversations/:id`
  - `GET /api/v1/conversations/:id/messages` (query: `page`, `limit`)
  - `POST /api/v1/conversations/:id/messages` (user message + generated assistant reply)

---

## 18) Testing status

Automated tests exist in two locations:

- Legacy baseline tests in `/tests` (root, health, env, 404)
- Phase tests in `src/tests/phase2|phase3|phase4|phase6|phase7`

Covered scenarios include:

- app/bootstrap and health behavior
- entitlement checks
- settings/assist org scoping
- knowledge CRUD/PDF upload/auth basics
- processing and reprocessing basics
- AI endpoint auth, fallback, and grounding wiring
- conversation CRUD, message + AI reply flow, `clientRequestId` idempotency, tenant isolation, RBAC, AI fallback integration (phase7)

Phase 8 quality gate results (verified):

- `npm run typecheck`: PASS (strict mode, separate `tsconfig.test.json` for tests)
- `npm run build`: PASS (emits to `dist/`)
- Prettier format check: PASS
- `npm run test`: PASS — 19 test files, 59 tests, 0 failures
- `npm run lint`: 150 pre-existing `no-explicit-any`/`no-unused-vars` errors in legacy files; Phase 8 files have 0 lint errors
- Database migration verification: PASS (fresh `drizzle-kit push` + constraints applied)

---

## 19) What is intentionally not built yet (major gaps)

Not yet implemented as backend modules/endpoints:

- Customer records + configurable customer fields
- Leads pipeline
- Escalations workflow
- Appointment requests
- Public chat/session API surface (all conversation endpoints are authenticated staff APIs today)
- Notification adapters/channels
- Additional LLM provider adapters (OpenAI, Anthropic, etc.)
- Vector DB (`pgvector`) storage/search
- Dedicated usage endpoints and richer observability/correlation IDs
- OpenAPI contract generation

These align with planned later phases in `PRD.md` and architecture docs.

---

## 20) Recommended next-phase implementation order (pragmatic)

1. ~~**Conversation core**: conversation/message tables + APIs + tenant/RBAC tests.~~ **Done (Phase 7)**
2. ~~**AI conversation integration**: bind `/ai/respond` into persisted conversation flow.~~ **Done (Phase 7)**
3. ~~**Backend stabilization + Gemini integration**: tsconfig fixes, strict tests, Gemini provider behind LLMProvider.~~ **Done (Phase 8)**
4. **Phase 9: Public WymAssist Chat/Session API**: unauthenticated or token-scoped chat surface for end users/widgets.
5. **Customer + lead capture**: organization-configurable collection and lead transitions.
6. **Escalation + appointment requests**: event capture and assignment/status basics.
7. **Remaining hardening**:
   - fix remaining ~150 pre-existing ESLint `no-explicit-any` / `no-unused-vars` errors
   - retrieval quality tests
   - plan migration path from JSON embeddings to pgvector
   - additional LLM provider adapters

---

## 21) Handoff checklist for next AI developer

- Do not break existing auth/RBAC/tenant boundaries.
- Preserve WymAssist entitlement gate on WymAssist-specific endpoints.
- Keep organization scoping explicit in every query.
- Use existing audit pattern for all sensitive writes.
- Extend from existing abstractions (`EmbeddingProvider`, `LLMProvider`) instead of bypassing them.
- Update this document after each major phase completion.

---

## 22) Phase 7 update (Conversation Core + AI Conversation Integration)

Completed additions:

- New `conversations` and `messages` schema with org scoping, lifecycle status, channel, metadata, and idempotency key support.
- New authenticated routes:
  - `POST /api/v1/conversations`
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/:id`
  - `PATCH /api/v1/conversations/:id`
  - `GET /api/v1/conversations/:id/messages`
  - `POST /api/v1/conversations/:id/messages`
- Message-post orchestration now persists:
  - USER message
  - AI response generation (using existing AI service and retrieval flow)
  - ASSISTANT message with `sources`, `usage`, `grounded`, and model metadata
- Retry-safe message posting with `clientRequestId` (conversation-scoped idempotency).
- Conversation state enforcement: non-`ACTIVE` conversations are read-only for new messages.
- Added Phase 7 test coverage for conversation CRUD, message flow, idempotency, tenant isolation, RBAC, and AI fallback integration.

Phase 7 follow-ups since:

- Migration `0004` adds supporting indexes: `conversations(organization_id, created_at)`, `conversations(organization_id, status)`, `messages(conversation_id, created_at)`, `messages(organization_id, created_at)`.
- `conversation.*` permissions added to the RBAC catalog and seeded role grants.
- `generateResponse` accepts `conversationContext`; the conversation service passes up to 24 recent messages as history (further bounded by `AI_HISTORY_MESSAGES`).
- Assistant replies persist `sources`, `usage`, `grounded`, `meta.model`, and `respondingToMessageId` in `messages.metadata`; responses include an `idempotentReplay` flag when a `clientRequestId` dedupes.
- Status transitions are validated (`ACTIVE -> CLOSED|ARCHIVED`, `CLOSED -> ARCHIVED`, no reopening); invalid transitions return 400 `INVALID_STATUS_TRANSITION`.
- AI generation failures inside the message flow return a fallback assistant message and audit `conversation.ai.failed`; token usage is recorded in `usage_records`.

---

## 23) Phase 8 update (Backend Stabilization + Google Gemini Integration)

### A. TypeScript stabilization

- Fixed `tsconfig.json`: `rootDir: "src"`, `include: ["src"]` for production; added `tsconfig.test.json` extending base with `include: ["src", "tests"]` for test typechecking.
- Installed missing `@types/pg` and `@types/pdf-parse`.
- Fixed conversation route query typing (`ParsedQs` → proper coerced types).
- Fixed conversation service history role mapping to preserve `'user' | 'assistant'` literal union.
- Fixed `ai.meta?.model` union narrowing (one branch is `{ error: string }` without `.model`).
- Changed route handler wrappers from `Promise<void>` to `Promise<unknown>` in AI, knowledge, conversation, and retrieval routes.
- `npm run typecheck` and `npm run build` both pass cleanly.

### B. Test stabilization

- Replaced permissive `expect([201, 403]).toContain(...)` assertions in Phase 3/4 tests with proper entitlement and permission setup in `beforeAll`, then exact status expectations.
- Fixed Phase 2 settings GET to expect exact 200 (never returns 204).
- Fixed Phase 4 PDF upload test to use correct schema fields (`title`, `fileName`, `mimeType`, `base64`).
- Fixed Phase 6 unauthenticated AI assertion to expect exact 401.
- Fixed Phase 2 entitlements test isolation (unique org slugs, clean-slate `beforeAll`).
- Fixed Phase 6 AI auth test isolation (explicit entitlement cleanup).
- Fixed root-level test imports (`.js` → `.ts` module resolution).
- Removed stale compiled `.js`/`.js.map` test artifacts from `tests/`.
- Fixed `tests/error.test.ts` to reflect actual middleware ordering (401 for unauthenticated `/api/v1/unknown` before 404 handler).
- Fixed app route mounting order: settings routes before generic `/:id` param catch.

### C. Schema fixes

- Converted inline `{ columns: [...], unique: true }` constraint objects (which `drizzle-kit push` ignored) to proper `unique('name').on(...)` calls using Drizzle's `unique` helper for:
  - `organization_products(organization_id, product_id)`
  - `conversations(organization_id, external_session_id)`
  - `messages(conversation_id, client_request_id)`
- These constraints are now enforced in the database, enabling correct `onConflictDoNothing` behavior for idempotency.

### D. Google Gemini integration

- **SDK**: `@google/genai@0.14.1` (official Google Gemini Developer API SDK)
- **Provider**: `GeminiProvider` class implementing `LLMProvider` in `src/modules/ai/provider.ts`
- **Model**: `gemini-2.5-flash` (configurable via `AI_MODEL`)
- **Request format**: `ai.models.generateContent({ model, contents, config })` with:
  - System instruction via `config.systemInstruction`
  - Structured conversation history with role mapping (`user` → `user`, `assistant` → `model`)
  - Temperature, max output tokens from existing env config
  - Request timeout via `AbortController` and `config.abortSignal`
- **Response handling**:
  - Text extraction with empty/blocked response safety
  - Usage metadata: `promptTokenCount` → `inputTokens`, `candidatesTokenCount` → `outputTokens`, `totalTokens`
  - Finish reason and raw metadata preserved in provider response
- **Error handling**:
  - `PROVIDER_TIMEOUT` for timeout/abort errors
  - `PROVIDER_ERROR` for all other SDK/network errors
  - API key sanitization in error messages (patterns like `key=...` become `key=***`)
  - No API keys exposed in logs, responses, or error payloads
- **Selection**: `getLLMProvider()` returns `LocalFakeProvider` or `GeminiProvider` based on `AI_PROVIDER` env var
- **No changes** to AI service orchestration, retrieval, conversation routes, or persistence

### E. Configuration

- Extended `src/config/env.ts`:
  - `AI_PROVIDER`: `LOCAL_FAKE` | `GEMINI`
  - `GEMINI_API_KEY`: optional at parse time (required when `AI_PROVIDER=GEMINI`)
  - `AI_REQUEST_TIMEOUT_MS`: default 30000
- Updated `.env.example` with all new settings and documentation
- Reuses existing `AI_MODEL`, `AI_TEMPERATURE`, `AI_MAX_OUTPUT_TOKENS` for Gemini

### F. Test coverage added

- `src/tests/phase8/gemini_provider.spec.ts` (8 tests):
  - Correct request payload with system instruction and user message
  - User/model history role mapping
  - Usage metadata extraction
  - Missing usage metadata handling
  - Empty/blocked response handling
  - Sanitized provider error (API key stripping)
  - Timeout handling (`PROVIDER_TIMEOUT`)
  - Idempotent LOCAL_FAKE behavior verification
- `src/tests/phase8/provider_selection.spec.ts` (3 tests):
  - LOCAL_FAKE returns deterministic output
  - GEMINI selection requires API key
  - Missing API key throws controlled error

### G. Files changed

Key files added or modified:

- `tsconfig.json` — fixed rootDir/include for production
- `tsconfig.test.json` — new, extends base for test typechecking
- `src/config/env.ts` — Gemini config extensions
- `src/modules/ai/provider.ts` — GeminiProvider + updated LLMProvider interface
- `src/modules/ai/service.ts` — structured history passing + totalTokens preservation
- `src/modules/ai/routes.ts` — handler wrapper type fix
- `src/modules/knowledge/routes.ts` — handler wrapper type fix
- `src/modules/conversations/routes.ts` — query typing + handler wrapper type fix
- `src/modules/conversations/service.ts` — history role typing + meta narrowing
- `src/modules/retrieval/routes.ts` — handler wrapper type fix
- `src/database/schema/core.ts` — unique constraint syntax fix
- `src/app.ts` — settings route mounting order fix
- `.env.example` — Gemini settings documentation
- `eslint.config.js` — dist/ exclusion + typescript-eslint installation
- 14 test files updated/added across phases 2-8
- `tests/*.js` and `tests/*.js.map` stale artifacts removed

### H. Database changes

- No new migrations required for the provider integration.
- Three unique constraints were corrected from ignored inline syntax to proper Drizzle `unique()` calls and applied to the database. These enforce existing intended uniqueness on `organization_products`, `conversations`, and `messages` tables.

### I. Security

- Gemini API key comes from environment only; never in source, logs, or responses.
- `wrapError()` sanitizes provider errors, stripping API-key-like patterns.
- Organization scoping, RBAC, and entitlement checks are unchanged.
- Retrieval sources remain application-controlled; Gemini citations are not fabricated.
- Conversation idempotency prevents duplicate AI calls on retry.

### J. Limitations

- ESLint has ~150 pre-existing `no-explicit-any` / `no-unused-vars` errors across legacy files. Phase 8 files have 0 lint errors. A broad cleanup was not in scope.
- PDF processing tests use a synthetic minimal PDF that `pdf-parse` cannot parse; the test verifies the graceful 400 PROCESSING_FAILED behavior rather than successful extraction.
- Gemini integration is tested via mocks only. A manual integration test with a real API key is recommended but not automated.
- No retry logic for transient Gemini failures; the existing fallback message is returned instead.

### K. Next phase recommendation

**Phase 9: Public WymAssist Chat/Session API** — unauthenticated or token-scoped endpoints for end-user chat widgets, followed by customer/lead capture and human workflows.

## 24) Phase 9 update (Public WymAssist Chat API)

### A. What was built

A public, unauthenticated visitor chat API mounted at `/api/v1/public/assist`, letting website visitors start a conversation with an organization's WymAssist assistant and exchange messages through the **existing** conversation + AI pipeline. No staff JWT required. Public access is a separate router mounted **before** the authenticated `/api/v1` routers (which call `router.use(authenticate)` and would otherwise 401 every public request).

### B. Endpoints

| Method | Path                                          | Auth             | Purpose                                                  |
| ------ | --------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `POST` | `/api/v1/public/assist/sessions`              | none             | Create a visitor chat session for `{ organizationSlug }` |
| `GET`  | `/api/v1/public/assist/session`               | `Bearer wymcs_…` | Session state (assistant + conversation status)          |
| `POST` | `/api/v1/public/assist/messages`              | `Bearer wymcs_…` | Send visitor message → persisted user+assistant messages |
| `GET`  | `/api/v1/public/assist/messages?page=&limit=` | `Bearer wymcs_…` | Conversation history scoped to the session               |

Create-session request: `{ organizationSlug: string, visitorName?: string (≤120), metadata?: object }`.
Response 201: `{ sessionId, sessionToken, expiresAt, assistant: { name, welcomeMessage, tone }, conversation: { id, status } }`.

Message request: `{ content: string (1..PUBLIC_CHAT_MAX_MESSAGE_LENGTH), clientRequestId?: string (8..120) }`.
Response 201: `{ userMessage, assistantMessage, idempotentReplay }` — public-shaped messages (`id, role, content, createdAt` + `grounded`/`sources` on assistant messages only; no internal metadata, usage, or staff fields).

### C. Visitor session security

- Opaque credential: `wymcs_<32 random bytes base64url>` (~256 bits entropy), distinct from staff JWTs.
- Persisted as **SHA-256 hash only** in `chat_sessions.token_hash` (unique index); raw token never stored, never logged.
- Bound to exactly one `organization_id` + one `conversation_id` (unique FK). Visitor supplies no org/conversation IDs — the server resolves them from the session record.
- `expires_at` enforced on every request (`PUBLIC_CHAT_SESSION_TTL_HOURS`, default 24h); `revoked_at` invalidates immediately.
- Eligibility is **re-validated on every request** (Phase 9.1): org active + entitlement + `public_chat_enabled` + allowed origins, so disabling the feature or revoking access cuts off live sessions.
- `last_seen_at` updated on each authenticated request.
- Sessions are revoked automatically when staff `ARCHIVE`s the conversation (`revokeSessionsForConversation` in `conversations/service.ts`). `CLOSED` keeps history readable but blocks new messages (409 `CONVERSATION_READ_ONLY`).
- Session token cannot authenticate any staff endpoint — it is not a JWT and staff middleware only accepts signed access tokens.

### D. Eligibility and tenant boundary

Before a session is created the server checks: org exists and `status='active'` → active `WYMASSIST` entitlement (`organizationHasProduct`) → `assistant_configurations.public_chat_enabled = true` → request `Origin` allowed when `allowed_origins` configured. Unknown orgs get a generic 404 `NOT_FOUND` ("Assistant not available") to avoid enumerating slugs.

All downstream work (conversation creation, retrieval, AI, usage, audit) runs under the **server-resolved** `organizationId`; nothing tenant-scoped is taken from the visitor.

### E. Rate limiting + CORS + origins

Three `express-rate-limit` limiters backed by a **shared PostgreSQL store** (`rate_limit_buckets` table, `src/modules/public/rateLimitStore.ts`, added in Phase 9.1 — no Redis exists in this deployment):

- Session creation: `PUBLIC_CHAT_SESSION_CREATE_MAX` (default 10) per `PUBLIC_CHAT_SESSION_WINDOW_MS` (default 15 min), keyed on `ip:organizationSlug`.
- Messages: `PUBLIC_CHAT_MESSAGE_MAX` (default 30) per `PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS` (default 60s), keyed on session ID.
- Reads: `PUBLIC_CHAT_READ_MAX` (default 60) per window, keyed on session ID.
  All return 429 with `RateLimit-*` standard headers. Counters are shared across processes/instances via Postgres (atomic upsert on `(key)`); expired buckets are swept lazily. Store failures propagate as errors (fail-closed — no silent unbounded access).

CORS: a `cors()` middleware scoped to `/api/v1/public/assist` reflects any origin by default; when `PUBLIC_CHAT_CORS_ORIGINS` is set it becomes an allowlist (validated at boot — entries must be bare `http(s)` origins, `*` and paths are rejected). This is browser hygiene only — real origin enforcement is per-organization via `allowed_origins` on the assistant config, normalized (lowercased host, trailing slash stripped) and checked server-side at session creation and **on every session-authenticated request** (`ORIGIN_NOT_ALLOWED` / `ORIGIN_REQUIRED` when `PUBLIC_CHAT_REQUIRE_ORIGIN=true`). CORS/Origin are **not** treated as authorization.

`TRUST_PROXY` env (default `false`) sets `app.set('trust proxy', …)`. Set it to the real trusted proxy hop count (e.g. `1`) behind a load balancer so `req.ip` reflects the client — session-creation limits key on it. Never set `true`/`all` with an untrusted chain or `X-Forwarded-For` spoofing bypasses the limiter.

### F. Reused pipeline

Visitor messages call `createUserMessageAndGenerateAssistant` directly — same retrieval, grounding, prompt, provider selection (LOCAL_FAKE/Gemini), fallback message, persisted `sources`/`grounded` metadata, usage records, and `clientRequestId` idempotency (`messages(conversation_id, client_request_id)` unique constraint). `userId` was made optional (visitors pass `null`; audit events record `actorUserId: null`). Staff `POST /conversations/:id/messages` is unchanged.

Phase 9.1: the function now wraps the whole flow in a transaction that `SELECT … FOR UPDATE`s the conversation row first, then re-checks idempotency inside the lock — concurrent duplicate `clientRequestId` requests serialize to exactly one user message, one assistant message, one AI call, and one usage record. Session creation also wraps conversation+session insert in one transaction so a failed session insert can't leave an orphaned conversation.

### G. Schema / migration

`drizzle/migrations/0005_phase9_public_chat.sql` + `src/database/schema/core.ts`:

- New `chat_sessions` table: `id, organization_id FK, conversation_id FK (unique), token_hash (unique), visitor_label, expires_at, revoked_at, last_seen_at, created_at` + indexes on `(organization_id)` and `(expires_at)`.
- `assistant_configurations` + `public_chat_enabled boolean not null default false` (opt-in), `allowed_origins text` (JSON array).
- Phase 9.1 added `rate_limit_buckets` (`key PK, hits, expires_at`) for the shared rate-limit store — `drizzle/migrations/0006_organic_lord_tyger.sql`.
- Migration 0005's re-add of Phase-8-era constraints uses `pg_constraint` existence checks (a plain `EXCEPTION WHEN duplicate_object` guard does **not** catch unique-constraint name collisions — those raise `duplicate_table` 42P07 via the backing index). Verified: full migration chain 0000–0006 applies cleanly on a fresh database, and `drizzle-kit migrate` is a no-op on the existing dev DB. **If 0005 was previously applied manually, insert its row into `drizzle.__drizzle_migrations` (sha256 of the file) before running `migrate`.**

### H. Config

New env vars (validated in `env.ts`, documented in `.env.example`): `PUBLIC_CHAT_SESSION_TTL_HOURS`, `PUBLIC_CHAT_MAX_MESSAGE_LENGTH`, `PUBLIC_CHAT_SESSION_CREATE_MAX`, `PUBLIC_CHAT_SESSION_WINDOW_MS`, `PUBLIC_CHAT_MESSAGE_MAX`, `PUBLIC_CHAT_READ_MAX`, `PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS`, `PUBLIC_CHAT_REQUIRE_ORIGIN`, `PUBLIC_CHAT_CORS_ORIGINS`, `TRUST_PROXY` (Phase 9.1).

`PATCH /api/v1/assist` now accepts `publicChatEnabled` (bool) and `allowedOrigins` (string[]); each entry is validated/normalized to a bare `http(s)` origin (paths, `*`, and malformed values → 400) and deduplicated; GET returns them normalized.

Phase 9.1: every session-authenticated request re-validates org status + WYMASSIST entitlement + `public_chat_enabled` + allowed origins (not just session creation) — disabling public chat or revoking the entitlement cuts off existing sessions immediately. Unexpected errors return a generic `INTERNAL_SERVER_ERROR` body; internals are logged server-side only (`src/middleware/error.ts`).

### I. Tests — `src/tests/phase9/` (22 tests, all passing)

`public_chat.spec.ts` (13): Session create (201 + token shape), no-entitlement 403 `PUBLIC_CHAT_UNAVAILABLE`, disabled 403 `PUBLIC_CHAT_DISABLED`, unknown org 404, per-org origin allow/deny, session state 200, missing/malformed/foreign credential 401 (incl. staff-JWT rejection), message exchange through the real pipeline, idempotent replay (same `clientRequestId` → `idempotentReplay: true`, no dup rows), session-scoped history (no internal fields), invalid payloads 400, org/visitor isolation (token B reads only conv B; staff conversation list returns 401 for visitor token), closed-conversation 409 `CONVERSATION_READ_ONLY`, expired → 401 `SESSION_EXPIRED`, archive → revocation → 401 `INVALID_SESSION`, per-session message rate limit (30×400 then 429).

`public_chat_hardening.spec.ts` (9, Phase 9.1): disabling public chat mid-session → 403 `PUBLIC_CHAT_DISABLED`; revoking entitlement mid-session → 403 `PUBLIC_CHAT_UNAVAILABLE`; same-org session isolation; 3-way concurrent duplicate `clientRequestId` → 1 user + 1 assistant + 1 usage record; concurrent session creation without collisions; `allowedOrigins` normalization + rejection of malformed/path-bearing values; normalized trailing-slash origin match at creation; shared rate-limit counters across two limiter instances; masked internal 5xx details.

### J. Files changed

- `src/modules/public/{schemas,service,middleware,routes}.ts` — new module
- `src/database/schema/core.ts` — `chat_sessions`, config columns, indexes
- `drizzle/migrations/0005_phase9_public_chat.sql` — new idempotent migration
- `src/modules/conversations/service.ts` — nullable `userId`, archive→revoke
- `src/modules/assist/config.ts` — `publicChatEnabled`/`allowedOrigins` PATCH+GET
- `src/app.ts` — public router mounted before authenticated `/api/v1` routers
- `src/config/env.ts`, `.env.example` — public-chat config
- `vitest.config.ts` — new; `testTimeout: 30s`, `hookTimeout: 60s` (shared dev DB can be slow under load)
- `src/tests/phase9/public_chat.spec.ts` — new suite
- `src/modules/public/rateLimitStore.ts` — Phase 9.1 Postgres-backed `express-rate-limit` store
- `drizzle/migrations/0006_organic_lord_tyger.sql` — `rate_limit_buckets` table
- `src/middleware/error.ts` — Phase 9.1: 5xx bodies masked (`INTERNAL_SERVER_ERROR`), internals logged server-side
- `src/tests/phase9/public_chat_hardening.spec.ts` — Phase 9.1 hardening suite
- `WymNet_AI.postman_collection.json` — Public Chat folder added

### K. Verified results

- `npm run typecheck` — PASS · `npm run build` — PASS · `npx prettier --check .` — PASS
- `npm test` — **21 files / 81 tests, all green** (Phase 9's 13 + Phase 9.1's 9)
- Targeted ESLint on Phase 9 files — 0 errors (legacy `any` debt in older files unchanged)
- `drizzle-kit migrate` — clean on a **fresh** database (0000–0006) and a no-op on the existing dev DB

### L. Limitations / before real traffic

- `PUBLIC_CHAT_REQUIRE_ORIGIN` defaults `false`; turn on (and set `PUBLIC_CHAT_CORS_ORIGINS` + per-org `allowed_origins`) for browser deployments.
- Set `TRUST_PROXY` to the real trusted hop count behind a load balancer — session-create limits key on `req.ip`. Do **not** set it permissive with an untrusted proxy chain (`X-Forwarded-For` spoofing would bypass the IP limiter).
- Rate limits are now shared via Postgres, but a saturated DB still degrades them — keep the DB healthy; store errors fail closed (request errors, not unbounded access).
- Per-message cost is controlled by rate limits + message-length cap, but there is no per-visitor daily/monthly quota or budget cap yet — heavy single-visitor usage within the rate limit still costs provider tokens.
- Gemini still mock-tested only; run a live-key smoke test before launch.

### M. Next phase recommendation

**Phase 10: embeddable chat widget + lead capture** — a thin JS widget consuming this API, plus optional visitor-email/lead fields on sessions, then human-handoff/escalation workflow.

## 25) Phase 10 update (Customer Identity and Lead Capture)

### A. Data model — why leads, not customers

Two new tables, no `customers` table: there is no authenticated customer identity in the product, "the same person" can only be approximated by contact fields (which are **not** unique — a visitor may enquire repeatedly), and a full CRM model is premature. `leads` carries the contact fields directly; multiple leads per person/session are supported.

- `leads`: `id, organization_id FK, conversation_id FK?, chat_session_id FK?, name?, email?, phone?, enquiry_category?, summary?, status, source, assigned_to FK?, consent_to_contact, client_request_id?, created_at, updated_at`. Unique on `(conversation_id, client_request_id)` for idempotent retries. Indexes on `(org, created_at)`, `(org, status)`, `(org, assigned_to)`, `(chat_session_id)`.
- `lead_notes`: `id, lead_id FK, organization_id FK, author_user_id FK, body, created_at` — internal staff notes.
- `lead_status` enum + pipeline: `NEW → CONTACTED → QUALIFIED → CONVERTED`, with `LOST` as a terminal off-ramp from any active state. Terminal states reject further transitions (`400 INVALID_STATUS_TRANSITION`).
- Enquiry categories: `GENERAL | SALES | SUPPORT | FEEDBACK | OTHER` (validated in Zod, stored as varchar).

### B. Public lead capture — `POST /api/v1/public/assist/leads`

Bearer `wymcs_…` session credential (same `authenticatePublicSession` middleware — expiry/revocation/eligibility revalidation included). Requires `assistant_configurations.lead_capture_enabled = true` (`403 LEAD_CAPTURE_DISABLED` otherwise). Body: `{ name?, email?, phone?, enquiryCategory?, summary?, consentToContact?, clientRequestId? }` — at least one of name/email/phone required.

- Org, conversation, and session are taken from the **server-resolved session record** — client-supplied `organizationId`/`conversationId`/`chatSessionId`/`status`/`assignedTo`/`source` are ignored (tested).
- Email lowercased; phone normalized to `+digits`; dedicated rate limit `PUBLIC_CHAT_LEAD_MAX` (default 5/window) keyed `lead:<sessionId>` on the shared Postgres store.
- Idempotency: same `clientRequestId` → replay returns the existing lead (`idempotentReplay: true`, 200). Identical normalized contact details on the same session → `deduplicated: true`, 200 — never silently overwrites or duplicates. Both checks run under `SELECT … FOR UPDATE` on the session row, so concurrent submissions serialize to one lead.
- Response is a safe shape only: `{ id, status, createdAt, idempotentReplay, deduplicated }` — no org/conversation/session ids, no contact fields.

### C. Staff lead management — `/api/v1/leads`

Authenticated + org-scoped + WYMASSIST entitlement (same `ensureAssistEntitlement` pattern). New permission `lead.write` (existing `lead.read` reused); both seeded for `Client Administrator` and `Client Staff` — run `npm run seed` (or `ts-node src/scripts/seed.ts`) on existing environments to grant them.

| Method | Path                                                               | Permission   | Notes                                                                                                                              |
| ------ | ------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/leads?page&limit&status&source&category&assignedTo&order` | `lead.read`  | Filters + pagination                                                                                                               |
| GET    | `/api/v1/leads/:id`                                                | `lead.read`  | Includes `notes[]`                                                                                                                 |
| PATCH  | `/api/v1/leads/:id`                                                | `lead.write` | Contact fields, status (validated transitions), `assignedTo` (must be an active user **in the same org** — `400 INVALID_ASSIGNEE`) |
| POST   | `/api/v1/leads/:id/notes`                                          | `lead.write` | Internal note `{ body }`                                                                                                           |

Cross-org reads/updates return 404 (no existence leak). `organizationId`, `conversationId`, `chatSessionId`, `clientRequestId`, timestamps are immutable — not in the PATCH schema.

### D. Audit

`lead.created` (actor `null` — visitor), `lead.status_changed` (from/to), `lead.assigned` (from/to), `lead.contact_updated` (changed fields), `lead.note_added`, `lead.updated`. All `resourceType: 'lead'`, org-scoped; no tokens or raw credentials stored.

### E. Files changed

- `src/database/schema/core.ts` — `leads`, `lead_notes`, `lead_status` enum
- `drizzle/migrations/0007_phase10_leads.sql` — new tables, FKs, indexes, unique constraint
- `src/modules/leads/{schemas,service,routes}.ts` — new module
- `src/modules/public/routes.ts` — `POST /leads` + `leadLimiter`
- `src/modules/rbac/permissions.ts` — `lead.write`; `src/scripts/seed.ts` — grants
- `src/config/env.ts`, `.env.example` — `PUBLIC_CHAT_LEAD_MAX`
- `src/app.ts` — leads router mounted (after public routes)
- `vitest.config.ts` — `hookTimeout: 180s` (loaded dev DB exceeded 60s in beforeAll)
- `src/tests/phase10/leads.spec.ts` — new suite (21 tests)

### F. Verified results

- `npm run typecheck` — PASS · `npm run build` — PASS · `npx prettier --check .` — PASS
- `npm test` — **22 files / 102 tests, all green** (Phase 10's 21 new)
- Targeted ESLint on leads/public/phase10 files — 0 errors
- `drizzle-kit migrate` — clean on a **fresh** database (0000–0007, all lead constraints verified) and applied cleanly to the existing dev DB

### G. Limitations

- Lead capture is **opt-in**: `lead_capture_enabled` must be turned on via `PATCH /api/v1/assist` (`{ leadCaptureEnabled: true }`) — public capture returns `LEAD_CAPTURE_DISABLED` otherwise.
- No lead merge/linking across sessions — "same person" is only approximated by normalized contact fields; a true customer identity layer can come later if needed.
- Dedupe compares name+email+phone+summary on the same session; same email on a _different_ session creates a new lead (intentional — supports multiple enquiries).
- Consent is a boolean flag only; a consent-text/version record would be needed for stricter jurisdictions.
- Gemini still mock-tested only.

## 26) Phase 11 update (Human Handoff and Escalation)

### A. Data model

Dedicated `handoffs` table rather than extending `conversations` — the handoff has its own lifecycle, and `conversations.status` already has separate ACTIVE/CLOSED/ARCHIVED semantics.

- `handoff_status` enum: `REQUESTED | QUEUED | ASSIGNED | RESOLVED | CANCELLED`. Public requests land directly in `QUEUED` (there is no triage step; `REQUESTED` is reserved for future routing).
- `handoff_requested_by` enum: `VISITOR | STAFF | SYSTEM`.
- `handoffs`: org + conversation FKs, nullable `chat_session_id`, `reason`, assignee/timestamps, `resolution_summary`, `cancelled_by`/`cancelled_at`/`cancellation_reason`.
- **`handoffs_active_conv_unique`** — partial unique index on `conversation_id` where status is non-terminal → at most one active handoff per conversation, enforced by the DB.
- `handoff_notes`: internal staff notes (mirrors `lead_notes`).
- `message_role` gained `'AGENT'` — staff replies are AGENT messages: visible in public history (unlike SYSTEM/internal notes) but distinguishable from AI replies.

### B. Lifecycle and transitions

`QUEUED → ASSIGNED → RESOLVED`; `CANCELLED` from `QUEUED` or `ASSIGNED`; `ASSIGNED → QUEUED` via release (`assign` with `userId: null`). Terminal states reject all transitions (`400 INVALID_STATUS_TRANSITION`). Claim is an atomic `UPDATE … WHERE status IN ('REQUESTED','QUEUED')` — concurrent claims resolve to one winner, loser gets `409 HANDOFF_ALREADY_CLAIMED`.

### C. Public API

- `POST /api/v1/public/assist/handoff` `{ reason? }` — session credential, gated by `assistant_configurations.escalation_enabled` (`403 ESCALATION_DISABLED`). Org/conversation/session are server-derived; client-supplied ids/status/assignee are ignored. Repeated requests return the same active handoff (`200 alreadyActive: true`). Rate limit: `PUBLIC_CHAT_HANDOFF_MAX` (default 5/window) on the shared Postgres store. Response: `{ id, status, createdAt, alreadyActive }` only.
- `GET /api/v1/public/assist/handoff` — `{ handoff: { id, status, createdAt } | null }` for widget polling.
- Closed/archived conversation → `409 CONVERSATION_READ_ONLY`; no silent reopen. Archived conversations also revoke sessions (existing Phase 9.1 behavior).

### D. AI pause/resume policy

Inside `createUserMessageAndGenerateAssistant` — after the existing `FOR UPDATE` conversation lock, before `generateResponse` — an active handoff produces a persisted assistant ack (`PUBLIC_CHAT_HANDOFF_ACK_MESSAGE`, metadata `handoffPaused: true`) instead of an AI call. No provider call, no usage record. Because handoff creation locks the same conversation row, a request created before a message always wins the race; an AI generation already in flight completes normally (it belongs to a pre-handoff message). **Resume**: AI resumes automatically on the next visitor message once the handoff is RESOLVED/CANCELLED, only while the conversation is ACTIVE — a staff-closed conversation never resumes AI (writes are rejected).

### E. Staff API — `/api/v1/handoffs`

New permissions: `handoff.read`, `handoff.write`, `handoff.assign` (seeded: Client Admin gets all three, Client Staff read+write, platform roles all three — run `npm run seed` on existing envs).

| Method | Path                                                    | Permission      | Rule                                                                                                                        |
| ------ | ------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/handoffs?page&limit&status&assignedTo&order`          | `handoff.read`  | org-scoped, paginated                                                                                                       |
| GET    | `/handoffs/:id`                                         | `handoff.read`  | includes `conversation` context, last 10 `recentMessages`, internal `notes[]`                                               |
| POST   | `/handoffs/:id/claim`                                   | `handoff.write` | atomic claim → self                                                                                                         |
| POST   | `/handoffs/:id/assign` `{ userId                        | null }`         | `handoff.assign`                                                                                                            | assign/reassign/release; assignee must be active same-org user |
| POST   | `/handoffs/:id/resolve` `{ resolutionSummary? }`        | `handoff.write` | assignee or `handoff.assign` holder; ASSIGNED only                                                                          |
| POST   | `/handoffs/:id/cancel` `{ reason? }`                    | `handoff.write` | QUEUED: any writer; ASSIGNED: assignee or assign holder                                                                     |
| POST   | `/handoffs/:id/notes` `{ body }`                        | `handoff.write` | internal note                                                                                                               |
| POST   | `/handoffs/:id/replies` `{ content, clientRequestId? }` | `handoff.write` | assignee only, ASSIGNED only, conversation must be ACTIVE; persists AGENT message, idempotent via `staff:{clientRequestId}` |

Cross-org access returns 404. Visitor tokens get 401 on all staff endpoints.

### F. Audit

`handoff.requested` (actor null — visitor), `handoff.claimed`, `handoff.assigned`, `handoff.released`, `handoff.resolved`, `handoff.cancelled`, `handoff.note_added`, `handoff.reply_sent` — all `resourceType: 'handoff'`, org-scoped, no session tokens in metadata.

### G. Files changed

- `src/database/schema/core.ts` — `handoffs`, `handoff_notes`, `handoff_status`/`handoff_requested_by` enums, `AGENT` message role
- `drizzle/migrations/0008_phase11_handoffs.sql` — tables, FKs, indexes, partial unique index, enum value
- `src/modules/handoffs/{schemas,service,routes}.ts` — new module
- `src/modules/public/routes.ts` — `POST/GET /handoff`, `handoffLimiter`, AGENT in public history filter
- `src/modules/conversations/service.ts` — AI-pause branch inside the existing transaction
- `src/modules/rbac/permissions.ts`, `src/scripts/seed.ts` — `handoff.*` permissions
- `src/config/env.ts`, `.env.example` — `PUBLIC_CHAT_HANDOFF_MAX`, `PUBLIC_CHAT_HANDOFF_ACK_MESSAGE`
- `src/app.ts` — handoffs router mounted
- `src/tests/phase11/handoffs.spec.ts` — 19 tests

### H. Verified results

- `npm run typecheck` — PASS · `npm run build` — PASS · `npx prettier --check .` — PASS
- `npm test` — **23 files / 121 tests, all green** (Phase 11's 19 new)
- Targeted ESLint on handoffs/public/phase11 files — 0 errors in new code
- `drizzle-kit migrate` — clean on a **fresh** database (0000–0008; `handoffs_active_conv_unique` and `AGENT` enum value verified) and applied cleanly to the existing dev DB

### I. Limitations

- Visitor sees no delivery/read receipt for staff replies — polling `GET /messages` is the only channel; no push/webhook yet.
- No SLA/queue metrics, agent presence, or routing rules — claim is first-come.
- Closing a conversation does not auto-cancel its handoff (staff should resolve/cancel explicitly); a closed conversation simply rejects new writes.
- `REQUESTED` is reserved in the enum but unused — requests enter `QUEUED` directly.
- Ack text is a single global env string; per-org customization would come from assistant config later.
- Gemini still mock-tested only — live-key smoke test outstanding.

---

## Frontend Phase 0/1 support changes (post-Phase 11)

Two small backend changes were made to support the new sibling frontend app (`../frontend`):

1. **Expired access tokens on refresh/logout** — `verifyAccessToken` in
   `src/modules/auth/service.ts` now accepts an `ignoreExpiration` option.
   `POST /auth/refresh` and `POST /auth/logout` verify the access token with
   expiration ignored, so a user idle past the 15-minute access TTL can still
   rotate/revoke refresh tokens (signature must still verify). All other routes
   keep normal expiry checks.
2. **Org-scoped entitlements** — `GET /api/v1/organizations/:id/products`
   (`src/modules/organizations/{controller,routes}.ts`) returns the caller's
   organization product list for entitlement-aware frontend navigation. Org
   scope enforced; `GET /admin/products` remains platform-only.

`npm run typecheck` — PASS after both changes.

---

## 27) Phase 12 update — Commercial feature set

### A. Appointments
`appointments` table + `appointmentStatusEnum` (`REQUESTED → CONFIRMED →
COMPLETED | CANCELLED | NO_SHOW`), linked to conversation + chat session,
idempotent via unique (conversationId, clientRequestId).
- Public: `POST /api/v1/public/assist/appointments` (session-scoped, rate-limited,
  gated by `appointmentRequestsEnabled`).
- Staff: `GET/PATCH /api/v1/appointments[/:id]` with `appointment.read` /
  `appointment.write`, status-transition validation, assignment, audit events.

### B. Customizable intake fields
`assistantConfigurations.intakeFields` (JSONB) lets each org define custom lead
fields (key/label/type/required/options). `leads.customFields` stores submissions;
public lead capture validates submitted fields against the configuration and
rejects unknown/invalid fields.

### C. Reports
`GET /api/v1/reports/enquiries?days=N` (`report.read`) returns org-scoped totals
for conversations, messages (+daily volume), leads, handoffs and appointments.

### D. Platform administration
`/api/v1/admin` (`platform.manage`): organization list/create/update including
status suspend/activate, subscriptions CRUD, platform usage overview, audit feed.
Client `PATCH /organizations/:id` can no longer change its own `status` (privilege
escalation fix). Org-facing `GET /organizations/me/subscription` added.

### E. Widget config + embeddable widget
`GET /api/v1/public/assist/config?organizationSlug=` returns public-safe branding,
welcome copy, feature flags and intake fields (origin-checked). The widget itself
is a dependency-free IIFE built from `frontend/src/widget` → `dist-widget/wymassist.js`
(~13KB), served by the backend at `/widget/` (`WIDGET_ASSETS_DIR`). Embed:
`<script src="<api>/widget/wymassist.js" data-org="<slug>" data-api="<api>" async>`.

### F. Notifications
`NotificationProvider` abstraction (console default, generic webhook via
`NOTIFICATION_WEBHOOK_URL`). Wired into lead capture, handoff request and
appointment request, honoring per-org `notifyOn*` flags + `notificationEmail`.

### G. WhatsApp channel scaffold
`/api/v1/webhooks/whatsapp` verification + inbound handler. Inbound messages
resolve the org via `organization_settings.whatsappPhoneNumberId` and reuse the
conversation pipeline (handoff pause + idempotency included). Outbound send
requires `WHATSAPP_ACCESS_TOKEN`; without it inbound still lands in the dashboard.
Channel enum extended (`WHATSAPP`, `FACEBOOK`, `INSTAGRAM`, `EMAIL`).

### H. Client dashboard (frontend)
Full WymAssist operational UI under `/dashboard/assist`: conversations inbox +
thread, handoff queue + agent console (claim/assign/reply/resolve), leads with
notes + custom fields, appointments with status actions, knowledge manager
(text + PDF + processing states), reports, settings (assistant config, branding,
intake-field editor, notification toggles, embed snippet), team/role management.
Platform admin section (`/dashboard/admin/*`): client orgs, subscriptions, usage.
Sidebar is entitlement- and permission-driven.

### I. Verified results
- `tsc` backend + frontend: PASS. `eslint` frontend: PASS. `vite build` + widget
  build: PASS. 50/50 frontend tests: PASS.
- Backend vitest suite (incl. `src/tests/phase12/appointments.spec.ts`) requires
  PostgreSQL — not runnable in this environment; run `docker compose up -d` then
  `npm test` + `npm run db:migrate` (migration `0009_phase12_appointments_intake.sql`).

### J. Known gaps
- Appointments are request-based; no calendar availability engine yet.
- WhatsApp send path untested without live Meta credentials.
- No email provider behind notifications (webhook/console only).
- Backend `eslint` has pre-existing repo-wide violations (any-typed code) —
  new modules were written to keep the lint surface no worse.

---

## 28) Phase 13 update — WymInsight AI + WymFlow AI

### A. WymInsight (`modules/insight`, `/api/v1/insight`)
- `datasets` (JSONB rows + column profile) and `insight_reports` tables; migration
  `0012_phase13_insight_flow.sql`.
- Upload accepts CSV or .xlsx (exceljs) up to 8MB via base64 JSON; first row is the
  header. Column profiling detects number/date/boolean/text, distinct counts,
  numeric min/max/mean/sum and top values.
- `POST /datasets/:id/analyze` runs: KPI extraction, monthly trend detection per
  date+numeric column pair (least-squares regression, growth %, 3-period forecast),
  then an LLM executive summary via the same `getLLMProvider()` abstraction
  (template fallback when the provider fails). Reports are stored and downloadable
  as CSV (`/reports/:id/download`).
- Permissions `insight.read` / `insight.write`; entitlement `WYMINSIGHT` enforced
  on every route; full tenant isolation + audit events.

### B. WymFlow (`modules/flow`, `/api/v1/flow`)
- `flow_definitions` (fields + ordered approval steps), `flow_instances`
  (submissions w/ data + document attachments), `flow_tasks` (per-step approvals,
  assignment, reminders) and `flow_activities` (instance timeline).
- Submission validates `data` against the definition's field spec (required,
  select options, types) and rejects unknown fields — same contract as WymAssist
  intake fields.
- Engine: submit → task for step 0 → approve advances and creates the next step's
  task → last approval marks the instance APPROVED; any rejection marks it
  REJECTED and cancels pending tasks. Tasks can be assigned (`flow.admin`) or
  decided by assignee/anyone for unassigned tasks (`flow.write`).
- `POST /flow/reminders/dispatch` (platform.manage) sends notifications for stale
  pending tasks via `notifyOrgDirect` — designed to be called by a scheduler.
- Permissions `flow.read` / `flow.write` / `flow.admin`; entitlement `WYMFLOW`;
  tenant isolation + audit events + per-instance activity log.

### C. Report downloads
`GET /api/v1/reports/enquiries?days=N&format=csv` returns the enquiry report as a
CSV attachment; the dashboard Reports page has a Download button.

### D. Frontend
`/dashboard/insight` (datasets upload/detail, run analysis, report view with
trend charts + CSV download) and `/dashboard/flow` (workflow definitions with
field/step editors, submissions with dynamic forms, instance detail with
approve/reject and activity timeline, My tasks queue). Sidebar groups appear only
when the org holds the product entitlement AND the user has the permission —
the modular-per-product subscription model now shows in the UI.

### E. Verified results
- Backend `tsc --noEmit`: PASS. Frontend `tsc -b`, `eslint`, `vite build`: PASS.
  Frontend tests: 50/50 PASS.
- `src/tests/phase13/` (insight + flow specs) written against the existing
  fixtures; requires PostgreSQL to execute — pending until Docker is available.
- exceljs added for .xlsx parsing (85 transitive deps; audit warnings noted).

### F. Brief coverage after this phase
All four development phases now have working implementations: WymAssist
(complete), WymInsight (upload → analyze → dashboard → download), WymFlow
(forms → approval workflow → tasks → reminders → activity). Remaining honest
gaps: no scheduler daemon (reminder sweep is an endpoint), no real billing,
WhatsApp needs live Meta credentials, appointment availability is request-based.
