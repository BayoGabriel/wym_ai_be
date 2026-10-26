# WymNet AI Solutions & Automation

## Product Requirements Document --- Backend Development Baseline

**Status:** Development baseline\
**Scope:** Backend only\
**Initial product:** WymAssist AI\
**Initial test organization:** WymNet\
**Future products:** WymInsight AI, WymFlow AI

---

# 10c. Phase 5 — Retrieval / RAG Foundation + Vector Search (Implementation Status)

### Embedding & Storage

- [x] Embedding provider abstraction (LOCAL for MVP)
- [x] Embedding configuration (provider/model/dimensions)
- [x] knowledge_chunks embedding fields (status/model/dim/digest)
- [ ] pgvector storage (planned for later)

### Retrieval Service

- [x] Query embedding
- [x] Org-scoped candidate selection (ACTIVE only)
- [x] Similarity scoring and ranking
- [x] Configurable topK/threshold
- [x] Retrieval API (POST /api/v1/knowledge/retrieve)

### Security

- [x] Authentication
- [x] RBAC (knowledge.read)
- [x] WYMASSIST entitlement
- [x] Tenant isolation in DB query

### RAG Context Prep

- [x] Stable result format for Phase 6 consumption
- [ ] Context size management policies (basic defaults only)

### Testing

- [ ] Embedding unit/integration tests
- [ ] Retrieval quality tests
- [ ] Tenant isolation tests (Phase 5 specific)
- [ ] Authorization tests (Phase 5 specific)
- [ ] Failure/retry tests

### Validation

- [ ] Typecheck
- [ ] Lint
- [ ] Tests
- [ ] Build
- [ ] Migration verified

---

# 10a. Phase 3 — Knowledge Management (Implementation Status)

### Foundation

- [x] Knowledge module
- [x] Knowledge database schema
- [x] Categories (FAQ, EVENTS, FEATURES, GENERAL)
- [x] Organization scoping
- [x] RBAC integration (knowledge.read, knowledge.write)

### Text Knowledge

- [x] Create text knowledge
- [x] Read knowledge
- [x] Update knowledge
- [x] Archive/delete knowledge (soft archive)

### PDF Knowledge

- [x] PDF upload
- [x] PDF validation (MIME, size, magic bytes)
- [x] PDF metadata
- [x] Storage abstraction (local dev)
- [ ] PDF secure access (download route; to be added in later phase if required)

### Management

- [x] Basic search (title/description ilike)
- [x] Filtering (category/sourceType/status)
- [x] Pagination
- [x] Status management (DRAFT/ACTIVE/ARCHIVED)
- [x] Audit logging (created/updated/archived/document.uploaded)

### Security

- [x] Tenant isolation
- [x] Authorization (RBAC + WYMASSIST entitlement)
- [x] File validation
- [x] File size limits (MAX_KNOWLEDGE_DOCUMENT_SIZE_MB)

### Testing

- [x] Integration tests (text/pdf/auth/tenant basics)
- [x] Tenant isolation tests (basic)
- [x] Authorization tests (basic)
- [x] File upload tests (valid/invalid)

### Validation

- [ ] Typecheck
- [ ] Lint
- [ ] Tests
- [ ] Build

---

# 10b. Phase 4 — Knowledge Processing & Chunking (Implementation Status)

### Processing Foundation

- [x] Processing module
- [x] Processing lifecycle (PENDING/PROCESSING/COMPLETED/FAILED)
- [x] Processing status on knowledge items
- [x] Error handling with `processingError`

### Text Processing

- [x] Text normalization
- [x] Deterministic chunking (char-based with overlap)
- [x] Chunk metadata

### PDF Processing

- [x] PDF extraction (pdf-parse)
- [x] PDF metadata preservation (filename)
- [x] Page metadata (per-chunk pageNumber when available)
- [x] Empty/unsupported PDF handling → FAILED
- [x] Corrupt PDF handling → FAILED
- [x] Scanned PDF handling (no OCR; fails gracefully)

### Reprocessing

- [x] Update invalidates/replaces old processed chunks
- [x] Manual reprocessing supported via endpoint
- [x] Failed processing handled safely

### Security

- [x] Tenant isolation on chunks
- [x] RBAC on processing endpoint
- [x] Secure document access (internal storage read only)
- [x] File validation preserved

### Audit

- [x] Processing started
- [x] Processing completed
- [x] Processing failed
- [x] Reprocessing

### Testing

- [x] Text processing tests
- [x] PDF processing tests
- [x] Chunking determinism/order/no-empty
- [x] Reprocessing tests
- [ ] Tenant isolation tests (Phase 4 specific) — basic coverage exists across phases
- [ ] Authorization tests (Phase 4 specific) — covered broadly; refine if needed
- [x] Failure tests

### Validation

- [ ] Typecheck
- [ ] Lint
- [ ] Tests
- [ ] Build
- [ ] Migration verified

---

## 1. Purpose

This document is the authoritative backend product-requirements
checklist for the WymNet AI platform.

The immediate goal is to build a secure,
modular, multi-tenant backend that can power WymAssist AI and later
support WymInsight AI and WymFlow AI.

The backend must be developed incrementally. Each checklist item should
be marked complete only after implementation and appropriate tests
exist.

### Implementation rule

The AI developer must not invent requirements, endpoints, database
fields, integrations, security behavior, or provider capabilities that
are not specified here or explicitly approved by the project owner.

When a requirement is ambiguous:

1.  Identify the ambiguity.
2.  State the assumption.
3.  Prefer the simplest implementation that preserves future
    extensibility.
4.  Do not silently introduce a large architectural decision.
5.  Record important decisions in architecture documentation.

---

# 2. Product Vision

WymNet AI Solutions & Automation is a reusable AI SaaS platform.

The product portfolio is:

- **WymAssist AI** --- Customer Support & Communication
- **WymInsight AI** --- Business Intelligence & Analytics
- **WymFlow AI** --- Business Process Automation

The platform must allow multiple organizations to use WymNet AI without
creating a separate application or database schema for every customer.

---

# 3. Backend-Only Scope

## Included

- Backend API
- Database
- Authentication
- Authorization
- Multi-tenancy
- Organization management
- User/role management
- Product/entitlement foundation
- WymAssist AI services
- Knowledge management
- Retrieval/RAG
- Conversations
- Customers
- Leads
- Escalations
- Appointment requests
- Chatbot configuration
- Usage tracking
- Audit logging
- Notifications foundation
- Integration abstraction
- Background jobs where required
- File/document storage abstraction
- Security
- Validation
- Testing
- Observability
- API documentation
- Deployment configuration

## Explicitly excluded for the first backend milestone

- Customer-facing chat UI
- Admin dashboard UI
- Client dashboard UI
- Website widget frontend
- WhatsApp production integration
- Facebook integration
- Instagram integration
- Email channel integration
- Full subscription billing implementation
- WymInsight implementation
- WymFlow implementation

Future products should receive architectural foundations where useful,
but their business functionality must not be implemented during the
WymAssist MVP unless explicitly requested.

---

# 4. Backend Development Principles

- Multi-tenancy from day one.
- Organization isolation at every relevant authorization/data-access
  boundary.
- Modular monolith first.
- API-first design.
- Strong validation at API boundaries.
- Explicit domain models.
- Provider integrations behind interfaces/adapters.
- AI provider integrations behind an abstraction.
- Retrieval must be separate from LLM generation.
- No business-critical logic inside controllers.
- No direct database access from controllers.
- All sensitive operations must be authorization checked.
- Important operations must be auditable.
- Idempotency should be used for operations that can be retried or
  duplicated.
- Secrets must never be hardcoded.
- Tests must accompany important functionality.
- Do not over-engineer future products.

---

# 5. MVP Success Criteria

The WymAssist backend MVP is complete when:

- [ ] WymNet organization can exist in the platform.
- [ ] Authorized users can authenticate.
- [ ] Organizations are isolated.
- [ ] WymNet business knowledge can be created and managed.
- [ ] Knowledge can be prepared for retrieval.
- [ ] A customer conversation can be created.
- [ ] A customer message can be processed.
- [ ] Relevant organization knowledge can be retrieved.
- [ ] An LLM can generate a grounded response.
- [ ] Unsupported questions receive controlled fallback behavior.
- [ ] Messages are persisted.
- [ ] Customers can be associated with conversations.
- [ ] Customer information can be collected.
- [ ] Leads can be created and tracked.
- [ ] Escalations can be created and reviewed through the API.
- [ ] Appointment requests can be captured.
- [ ] Chatbot configuration can be stored per organization.
- [ ] Usage can be recorded.
- [ ] Audit events can be recorded.
- [ ] API authentication and authorization are tested.
- [ ] Tenant isolation is tested.
- [ ] Core services have automated tests.
- [ ] API documentation exists.
- [ ] The backend can support another organization without code
      changes specific to that organization.

---

# 6. Phase 0 --- Backend Project Foundation

### Repository

- [ ] Create backend repository/project.
- [ ] Establish TypeScript configuration.
- [ ] Establish source directory structure.
- [ ] Establish environment configuration.
- [ ] Add environment validation.
- [ ] Add package scripts.
- [ ] Add linting.
- [ ] Add formatting.
- [ ] Add type checking.
- [ ] Add test framework.
- [ ] Add CI checks.

### Application foundation

- [ ] Create application bootstrap.
- [ ] Create HTTP server.
- [ ] Create health endpoint.
- [ ] Create readiness endpoint if required.
- [ ] Add centralized error handling.
- [ ] Add request validation.
- [ ] Add structured logging.
- [ ] Add request/correlation IDs.
- [ ] Add graceful shutdown.
- [ ] Add configuration module.

### Database

- [ ] Configure PostgreSQL.
- [ ] Configure ORM/database access layer.
- [ ] Establish migration workflow.
- [ ] Establish seed workflow.
- [ ] Establish database test strategy.
- [ ] Document local development database setup.

---

# 7. Phase 1 --- Platform Identity and Multi-Tenancy

## Organizations

- [ ] Create organization entity.
- [ ] Create organization status.
- [ ] Create organization CRUD/service.
- [ ] Generate stable organization identifiers.
- [ ] Support organization slug where required.
- [ ] Prevent unauthorized cross-organization access.
- [ ] Add organization lifecycle states.

Suggested states:

- `active`
- `suspended`
- `pending`
- `archived`

Exact states may be refined during implementation.

## Users

- [ ] Create user entity.
- [ ] Associate users with organizations.
- [ ] Support platform-level users.
- [ ] Support client users.
- [ ] Implement user lifecycle/status.
- [ ] Implement user retrieval scoped to authorized organization.

## Authentication

- [ ] Implement login.
- [ ] Implement password hashing.
- [ ] Implement credential validation.
- [ ] Implement access-token/session strategy.
- [ ] Implement logout/revocation strategy where applicable.
- [ ] Implement authentication middleware.
- [ ] Implement protected routes.
- [ ] Implement authentication failure handling.
- [ ] Add rate limiting to authentication endpoints.
- [ ] Add tests for authentication.

## Roles and permissions

Initial roles:

- [ ] WymNet Super Administrator

- [ ] WymNet Administrator

- [ ] Client Administrator

- [ ] Client Staff

- [ ] Define permission model.

- [ ] Define role-permission relationships.

- [ ] Implement authorization middleware/service.

- [ ] Test privilege boundaries.

- [ ] Test cross-tenant access prevention.

---

# 8. Phase 2 --- Platform Product and Entitlement Foundation

The backend must recognize that WymAssist, WymInsight and WymFlow are
separate products.

- [ ] Create product entity.
- [ ] Seed WymAssist.
- [ ] Seed WymInsight.
- [ ] Seed WymFlow.
- [ ] Create organization-product relationship.
- [ ] Create entitlement/status model.
- [ ] Support product activation/deactivation.
- [ ] Add product access checks.
- [ ] Ensure WymAssist functionality can require a WymAssist
      entitlement.
- [ ] Keep billing implementation separate from entitlement logic.

### Subscription foundation

- [ ] Create subscription model.
- [ ] Create plan model if required.
- [ ] Store subscription status.
- [ ] Store subscription dates.
- [ ] Store organization association.
- [ ] Store product association.
- [ ] Support future usage limits.
- [ ] Do not implement payment provider integration in MVP unless
      explicitly requested.

---

# 9. Phase 3 --- WymAssist Organization Configuration

- [ ] Create chatbot configuration entity.
- [ ] Associate configuration with organization.
- [ ] Configure assistant name.
- [ ] Configure welcome message.
- [ ] Configure tone/personality settings.
- [ ] Configure fallback behavior.
- [ ] Configure escalation behavior.
- [ ] Configure operating hours if required.
- [ ] Configure contact information.
- [ ] Configure branding metadata.
- [ ] Validate configuration.
- [ ] Enforce organization ownership.

---

# 10. Phase 4 --- WymAssist Knowledge Base

## Knowledge articles

- [ ] Create knowledge article entity.
- [ ] Associate every article with an organization.
- [ ] Add title.
- [ ] Add content.
- [ ] Add status.
- [ ] Add timestamps.
- [ ] Implement create.
- [ ] Implement update.
- [ ] Implement delete/archive.
- [ ] Implement list/search.
- [ ] Enforce organization authorization.

## FAQs

- [ ] Create FAQ entity.
- [ ] Store question.
- [ ] Store answer.
- [ ] Associate FAQ with organization.
- [ ] Implement CRUD.
- [ ] Support active/inactive state.
- [ ] Support ordering or metadata if useful.

## Documents

Architecturally support:

- [ ] Document metadata.
- [ ] Object-storage reference.
- [ ] Processing status.
- [ ] Document ownership.
- [ ] Document deletion.
- [ ] Document processing errors.

MVP document types may be limited until explicitly approved.

## Knowledge lifecycle

- [ ] Define knowledge statuses.
- [ ] Define ingestion/processing states.
- [ ] Prevent incomplete knowledge from being used for production
      retrieval.
- [ ] Track knowledge updates.
- [ ] Track ingestion failures.

---

# 11. Phase 5 --- Retrieval / RAG

The AI must primarily answer using organization-approved information.

- [ ] Select vector storage technology.
- [ ] Configure vector storage.
- [ ] Implement embedding provider abstraction.
- [ ] Generate embeddings for approved knowledge.
- [ ] Store embeddings.
- [ ] Implement chunking strategy.
- [ ] Store chunk/source metadata.
- [ ] Implement semantic retrieval.
- [ ] Scope retrieval by organization.
- [ ] Add relevance threshold.
- [ ] Return source references/metadata internally.
- [ ] Handle no-result cases.
- [ ] Test cross-tenant retrieval isolation.
- [ ] Test irrelevant knowledge behavior.
- [ ] Test stale/inactive knowledge exclusion.

### Retrieval rule

A retrieval query must never search another organization's knowledge.

---

# 12. Phase 6 --- AI Provider Layer

Do not couple domain services directly to one AI vendor.

- [ ] Define LLM provider interface.
- [ ] Define embedding provider interface.
- [ ] Implement initial provider adapter.
- [ ] Add timeout handling.
- [ ] Add retry policy where safe.
- [ ] Add provider error normalization.
- [ ] Add token/usage tracking where available.
- [ ] Protect API credentials.
- [ ] Add provider health/error logging.

## Response generation

- [ ] Build system prompt strategy.
- [ ] Inject organization configuration.
- [ ] Inject retrieved knowledge.
- [ ] Include relevant conversation context.
- [ ] Instruct model not to invent unsupported information.
- [ ] Define fallback behavior.
- [ ] Define escalation signals.
- [ ] Store generation metadata where appropriate.
- [ ] Never expose provider secrets through the API.

---

# 13. Phase 7 --- Conversations and Messages

## Customers

- [ ] Create customer entity.
- [ ] Associate customer with organization.
- [ ] Support anonymous/visitor sessions where appropriate.
- [ ] Store contact information only when provided/collected.
- [ ] Protect customer information.

## Conversations

- [ ] Create conversation entity.
- [ ] Associate with organization.
- [ ] Associate with customer/session.
- [ ] Store channel.
- [ ] Store status.
- [ ] Store timestamps.
- [ ] Implement conversation creation.
- [ ] Implement conversation retrieval.
- [ ] Implement conversation listing.
- [ ] Implement conversation filtering.
- [ ] Enforce authorization.

## Messages

- [ ] Create message entity.
- [ ] Associate with conversation.
- [ ] Store role.
- [ ] Store content.
- [ ] Store timestamp.
- [ ] Store relevant AI metadata where appropriate.
- [ ] Implement message persistence.
- [ ] Prevent unauthorized message access.

---

# 14. Phase 8 --- End-to-End AI Conversation

Implement the first complete backend flow:

```text
Customer message
    ↓
Authenticate/identify session
    ↓
Resolve organization
    ↓
Load chatbot configuration
    ↓
Load conversation
    ↓
Store customer message
    ↓
Retrieve organization knowledge
    ↓
Build AI context
    ↓
Generate response
    ↓
Apply response controls
    ↓
Store AI message
    ↓
Record usage
    ↓
Return response
```

Checklist:

- [ ] Conversation endpoint exists.
- [ ] Message endpoint exists.
- [ ] Organization context is resolved safely.
- [ ] Knowledge retrieval works.
- [ ] AI response generation works.
- [ ] Response is stored.
- [ ] Errors are handled safely.
- [ ] Unsupported questions trigger fallback.
- [ ] Escalation can be triggered.
- [ ] End-to-end integration test passes.

---

# 15. Phase 9 --- Customer Information Collection

- [ ] Create configurable customer-field model.
- [ ] Associate fields with organization.
- [ ] Support field types.
- [ ] Support required/optional.
- [ ] Validate submitted values.
- [ ] Store collected values securely.
- [ ] Associate collected data with customer/conversation.
- [ ] Prevent unauthorized access.
- [ ] Add audit events for sensitive administrative operations.

Example fields:

- name
- email
- phone
- organization-specific fields

Do not hardcode school-specific fields into the platform.

---

# 16. Phase 10 --- Lead Management

- [ ] Create lead entity.
- [ ] Associate lead with organization.
- [ ] Associate lead with customer.
- [ ] Associate lead with conversation where applicable.
- [ ] Store enquiry.
- [ ] Store product/service interest.
- [ ] Store source/channel.
- [ ] Store timestamps.
- [ ] Implement lead status.

Initial proposed statuses:

- `new`

- `contacted`

- `qualified`

- `converted`

- `closed`

- [ ] Implement lead creation.

- [ ] Implement lead retrieval.

- [ ] Implement lead listing/filtering.

- [ ] Implement status changes.

- [ ] Implement authorization.

- [ ] Add audit logging for important status changes.

---

# 17. Phase 11 --- Human Escalation

- [ ] Create escalation entity.
- [ ] Associate escalation with organization.
- [ ] Associate escalation with conversation.
- [ ] Store reason.
- [ ] Store status.
- [ ] Store timestamps.
- [ ] Implement escalation creation.
- [ ] Implement escalation retrieval.
- [ ] Implement escalation assignment foundation.
- [ ] Implement escalation status changes.
- [ ] Preserve conversation history.
- [ ] Add notification abstraction.
- [ ] Prevent unauthorized access.

Initial statuses:

- `open`
- `assigned`
- `resolved`
- `closed`

---

# 18. Phase 12 --- Appointment Requests

For MVP, appointment requests do not need direct calendar
synchronization.

- [ ] Create appointment request entity.
- [ ] Associate with organization.
- [ ] Associate with customer.
- [ ] Associate with conversation.
- [ ] Store preferred date.
- [ ] Store preferred time.
- [ ] Store reason.
- [ ] Store status.
- [ ] Implement create.
- [ ] Implement retrieval/listing.
- [ ] Implement authorization.
- [ ] Add future calendar integration abstraction.

---

# 19. Phase 13 --- Website Channel Backend

The frontend widget is out of scope, but the backend must expose the
APIs required by it.

- [ ] Define public chat-session model.
- [ ] Define safe organization/widget identification.
- [ ] Define public conversation creation.
- [ ] Define public message submission.
- [ ] Prevent arbitrary organization access.
- [ ] Add abuse/rate controls.
- [ ] Add request validation.
- [ ] Define CORS policy.
- [ ] Define origin/domain validation strategy if required.
- [ ] Document widget API contract.

---

# 20. Phase 14 --- Usage Tracking

- [ ] Create usage record model.
- [ ] Associate usage with organization.
- [ ] Track AI requests.
- [ ] Track messages where useful.
- [ ] Track token/provider usage where available.
- [ ] Track time period.
- [ ] Make usage data queryable.
- [ ] Keep usage separate from billing calculations.
- [ ] Prepare for future plan limits.

---

# 21. Phase 15 --- Audit and Activity Logging

- [ ] Create audit event model.
- [ ] Record actor.
- [ ] Record organization.
- [ ] Record action.
- [ ] Record resource type.
- [ ] Record resource ID.
- [ ] Record timestamp.
- [ ] Record relevant metadata without leaking secrets.
- [ ] Log authentication/security events.
- [ ] Log important administrative operations.
- [ ] Provide query/filter API for authorized administrators.

Never log:

- passwords
- access tokens
- API keys
- secret credentials
- unnecessary sensitive customer information

---

# 22. Phase 16 --- Notifications Foundation

- [ ] Define notification service interface.
- [ ] Define notification event model if needed.
- [ ] Support future email notifications.
- [ ] Support future WhatsApp notifications.
- [ ] Support future in-app notifications.
- [ ] Keep providers behind adapters.
- [ ] Do not implement unnecessary providers during MVP.

---

# 23. Phase 17 --- File and Document Storage Foundation

- [ ] Define file metadata model.
- [ ] Define storage abstraction.
- [ ] Implement object-storage adapter.
- [ ] Store file references rather than large binary data in
      PostgreSQL.
- [ ] Validate file type.
- [ ] Validate file size.
- [ ] Scope files to organizations.
- [ ] Prevent unauthorized file retrieval.
- [ ] Support deletion.
- [ ] Track processing status.

---

# 24. Phase 18 --- API Design and Documentation

- [ ] Establish API versioning strategy.
- [ ] Establish route naming conventions.
- [ ] Establish response format.
- [ ] Establish error format.
- [ ] Establish pagination.
- [ ] Establish filtering conventions.
- [ ] Establish sorting conventions.
- [ ] Establish authentication conventions.
- [ ] Document all public/admin endpoints.
- [ ] Generate or maintain OpenAPI documentation.
- [ ] Document authentication.
- [ ] Document tenant behavior.
- [ ] Document error codes.

---

# 25. Phase 19 --- Security

- [ ] Password hashing.
- [ ] Authentication controls.
- [ ] Authorization controls.
- [ ] Tenant isolation.
- [ ] Input validation.
- [ ] Output validation where appropriate.
- [ ] Rate limiting.
- [ ] CORS configuration.
- [ ] Security headers.
- [ ] Secret management.
- [ ] Database access controls.
- [ ] Secure file access.
- [ ] Audit logging.
- [ ] Dependency vulnerability checks.
- [ ] Production error sanitization.
- [ ] Request size limits.
- [ ] AI prompt/data isolation.
- [ ] Prevent prompt injection from bypassing tenant boundaries.
- [ ] Prevent retrieved knowledge from overriding platform security
      rules.

---

# 26. Phase 20 --- Testing

## Unit tests

- [ ] Domain/service tests.
- [ ] Validation tests.
- [ ] Authorization tests.
- [ ] AI prompt/context tests.
- [ ] Retrieval tests.

## Integration tests

- [ ] Database integration tests.
- [ ] Authentication tests.
- [ ] Organization tests.
- [ ] Knowledge tests.
- [ ] Conversation tests.
- [ ] Lead tests.
- [ ] Escalation tests.
- [ ] Appointment tests.

## Security tests

- [ ] Cross-tenant access attempts.
- [ ] Privilege escalation attempts.
- [ ] Invalid authentication.
- [ ] Expired/revoked credentials.
- [ ] Rate-limit behavior.
- [ ] Unauthorized resource access.

## End-to-end backend tests

- [ ] Create organization.
- [ ] Create client administrator.
- [ ] Add knowledge.
- [ ] Start customer session.
- [ ] Ask supported question.
- [ ] Retrieve knowledge.
- [ ] Generate response.
- [ ] Store conversation.
- [ ] Capture customer.
- [ ] Create lead.
- [ ] Escalate unresolved question.
- [ ] Record usage.

---

# 27. Phase 21 --- Observability and Operations

- [ ] Structured logs.
- [ ] Error tracking.
- [ ] Request IDs.
- [ ] AI provider monitoring.
- [ ] Database monitoring.
- [ ] Retrieval failure monitoring.
- [ ] Background job monitoring where applicable.
- [ ] Health checks.
- [ ] Readiness checks.
- [ ] Metrics foundation.
- [ ] Operational alerts for critical failures.

---

# 28. Phase 22 --- Deployment

- [ ] Development environment.
- [ ] Test environment.
- [ ] Production environment.
- [ ] Environment variable strategy.
- [ ] Database migration strategy.
- [ ] Secret management strategy.
- [ ] Containerization if applicable.
- [ ] CI/CD.
- [ ] Database backup strategy.
- [ ] Logging destination.
- [ ] Monitoring.
- [ ] Rollback strategy.
- [ ] Production health checks.

---

# 29. Phase 23 --- WymAssist Backend MVP Completion

All of the following must be complete:

- [ ] Multi-tenant organizations.
- [ ] Authentication.
- [ ] RBAC.
- [ ] WymAssist entitlement.
- [ ] Chatbot configuration.
- [ ] Knowledge base.
- [ ] Retrieval/RAG.
- [ ] AI provider abstraction.
- [ ] Conversations.
- [ ] Messages.
- [ ] Customers.
- [ ] Configurable customer fields.
- [ ] Leads.
- [ ] Escalations.
- [ ] Appointment requests.
- [ ] Public chat API.
- [ ] Usage tracking.
- [ ] Audit logging.
- [ ] Security controls.
- [ ] Tests.
- [ ] API documentation.
- [ ] Deployment documentation.

---

# 30. Future Product --- WymInsight AI

WymInsight is **not an MVP implementation target**.

The backend should eventually support:

### Data ingestion

- [ ] Excel upload.
- [ ] CSV upload.
- [ ] Dataset metadata.
- [ ] Dataset validation.
- [ ] Dataset versioning.
- [ ] Processing status.

### Analysis

- [ ] Data profiling.
- [ ] AI-assisted analysis.
- [ ] KPI generation.
- [ ] Trend detection.
- [ ] Pattern detection.
- [ ] Opportunity identification.
- [ ] Forecasting.

### Reporting

- [ ] Dashboard data APIs.
- [ ] Chart configuration/data APIs.
- [ ] Executive summaries.
- [ ] Report generation.
- [ ] Downloadable reports.

### Product integration

- [ ] Reuse platform authentication.
- [ ] Reuse organizations.
- [ ] Reuse RBAC.
- [ ] Reuse product entitlements.
- [ ] Reuse usage tracking.
- [ ] Reuse audit logging.

---

# 31. Future Product --- WymFlow AI

WymFlow is **not an MVP implementation target**.

The backend should eventually support:

### Forms

- [ ] Form definitions.
- [ ] Configurable fields.
- [ ] Form submissions.
- [ ] Validation.
- [ ] Organization ownership.

### Workflows

- [ ] Workflow definitions.
- [ ] Workflow states.
- [ ] Approval steps.
- [ ] Task assignment.
- [ ] Status tracking.
- [ ] Workflow history.

### Documents

- [ ] Document submissions.
- [ ] Document metadata.
- [ ] Document processing.
- [ ] Document permissions.

### Automation

- [ ] Automated reminders.
- [ ] Notifications.
- [ ] Trigger/action model.
- [ ] Scheduled actions.
- [ ] External integrations.

### Product integration

- [ ] Reuse platform authentication.
- [ ] Reuse organizations.
- [ ] Reuse RBAC.
- [ ] Reuse product entitlements.
- [ ] Reuse usage tracking.
- [ ] Reuse audit logging.

---

# 32. Future Integrations

These are architectural targets, not MVP requirements:

- [ ] WhatsApp adapter.
- [ ] Facebook adapter.
- [ ] Instagram adapter.
- [ ] Email adapter.
- [ ] Calendar adapter.
- [ ] External API adapter framework.

Each integration should use an adapter/interface approach rather than
coupling business logic directly to a provider.

---

# 33. Definition of Done for Any Backend Feature

A feature is not "done" merely because the endpoint works.

A feature should be considered complete only when applicable:

- [ ] Database changes are implemented.
- [ ] Migration exists.
- [ ] Domain/service logic exists.
- [ ] Validation exists.
- [ ] Authorization exists.
- [ ] Tenant isolation is enforced.
- [ ] Error handling exists.
- [ ] Tests exist.
- [ ] Logging exists where appropriate.
- [ ] API documentation exists.
- [ ] Relevant audit events exist.
- [ ] No secrets are exposed.
- [ ] Existing tests still pass.
- [ ] Type checking passes.
- [ ] Linting passes.

---

# 34. AI Developer Operating Rules

The AI developer must follow these rules throughout development.

## Rule 1 --- Do not silently expand scope

Do not implement WymInsight, WymFlow, WhatsApp, billing, or other future
functionality simply because it appears in this document.

Only implement the current phase.

## Rule 2 --- Do not invent provider behavior

If an external provider is required and documentation is unavailable,
stop at the integration boundary and document what is unknown.

Do not invent API endpoints, request formats, authentication mechanisms,
webhook formats, limits, or pricing.

## Rule 3 --- Do not weaken tenant isolation

Every organization-owned query must be organization-scoped.

Do not rely solely on frontend filtering.

## Rule 4 --- Do not expose internal implementation details

API responses must not expose database internals, secrets, provider
credentials, stack traces, or unnecessary AI metadata.

## Rule 5 --- Prefer reversible decisions

When requirements are uncertain, use interfaces, adapters,
configuration, and modular boundaries rather than hardcoding assumptions
into the domain.

## Rule 6 --- Update the checklist

After completing a feature:

1.  Run tests.
2.  Run type checking.
3.  Run linting.
4.  Mark the relevant checkbox as complete.
5.  Record important architectural decisions.
6.  Report remaining work.

## Rule 7 --- Never mark incomplete work as complete

A checkbox means the feature has been implemented and verified.

---

# 35. Backend Milestone Order

The AI developer should implement in this order:

1.  [ ] Project foundation
2.  [ ] Database
3.  [ ] Organizations
4.  [ ] Users
5.  [ ] Authentication
6.  [ ] Roles and permissions
7.  [ ] Product/entitlement foundation
8.  [ ] WymAssist configuration
9.  [ ] Knowledge base
10. [ ] Retrieval/RAG
11. [ ] AI provider layer
12. [ ] Conversations
13. [ ] Messages
14. [ ] End-to-end AI conversation
15. [ ] Customer information collection
16. [ ] Leads
17. [ ] Escalations
18. [ ] Appointment requests
19. [ ] Public chat API
20. [ ] Usage
21. [ ] Audit logging
22. [ ] Security hardening
23. [ ] Testing
24. [ ] Observability
25. [ ] Deployment
26. [ ] WymAssist MVP verification

---

# 36. Final Backend Objective

The first backend release must establish this capability:

```text
WymNet AI Platform
        │
        ├── Organization
        │      ├── Users
        │      ├── Configuration
        │      ├── Knowledge
        │      ├── Customers
        │      ├── Conversations
        │      ├── Leads
        │      ├── Escalations
        │      └── Appointments
        │
        └── WymAssist AI
               │
               ├── Retrieval
               ├── LLM
               └── Customer Conversation
```

The backend should then be capable of adding another organization
without creating organization-specific code.

That is the primary architectural success condition for the first phase.
