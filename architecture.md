# WymNet AI Solutions & Automation

## Backend Architecture Specification

**Status:** Development baseline\
**Scope:** Backend only\
**Architecture style:** Modular monolith\
**Primary product:** WymAssist AI\
**Future products:** WymInsight AI, WymFlow AI

---

# 1. Architecture Objective

The backend must be the reusable platform foundation for multiple WymNet
AI products.

The architecture must support:

- Multiple organizations.
- Multiple users per organization.
- Multiple products.
- Organization-specific AI configuration.
- Organization-specific knowledge.
- Organization-specific conversations and customers.
- Organization-specific leads and appointments.
- Future integrations.
- Future WymInsight and WymFlow modules.

The first implementation should be a **modular monolith**, not a
distributed microservice system.

---

# 2. Recommended Technology Direction

Technology choices should be confirmed against the existing repository
before implementation.

Recommended baseline:

Layer Technology

---

Language TypeScript
Runtime Node.js
HTTP API Express
Database PostgreSQL
ORM Drizzle ORM
Vector search PostgreSQL + pgvector initially
Cache/queue Redis when required
Object storage S3-compatible storage
AI Provider abstraction with an initial LLM provider
API documentation OpenAPI
Testing Vitest/Jest + integration tests
Containers Docker
Deployment AWS or existing WymNet infrastructure
Logging Structured JSON logs
Observability Application logs + metrics/tracing foundation

These are recommendations, not permission to replace an existing working
project stack without inspection.

---

# 3. High-Level Architecture

```text
                         Internet
                            │
                            ▼
                  ┌────────────────────┐
                  │     API Gateway    │
                  │ / Load Balancer    │
                  └─────────┬──────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │   WymNet AI API    │
                  │  Modular Monolith  │
                  └─────────┬──────────┘
                            │
        ┌───────────────────┼─────────────────────┐
        │                   │                     │
        ▼                   ▼                     ▼
 ┌─────────────┐     ┌──────────────┐      ┌──────────────┐
 │ Platform    │     │ WymAssist    │      │ Integrations │
 │ Modules     │     │ Modules      │      │              │
 └─────────────┘     └──────────────┘      └──────────────┘
        │                   │                     │
        └───────────────────┼─────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
    PostgreSQL          Vector Store       Object Storage
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                            ▼
                     AI Provider(s)
```

---

# 4. Modular Monolith

The application should be logically separated into modules even though
it initially runs as one deployable backend.

Recommended structure:

```text
src/
├── core/
│   ├── config/
│   ├── database/
│   ├── errors/
│   ├── http/
│   ├── logger/
│   ├── security/
│   └── observability/
│
├── modules/
│   ├── auth/
│   ├── organizations/
│   ├── users/
│   ├── roles/
│   ├── products/
│   ├── subscriptions/
│   ├── chatbot/
│   ├── knowledge/
│   ├── retrieval/
│   ├── ai/
│   ├── customers/
│   ├── conversations/
│   ├── leads/
│   ├── escalations/
│   ├── appointments/
│   ├── usage/
│   ├── audit/
│   ├── notifications/
│   ├── files/
│   └── integrations/
│
└── app.ts
```

Each module should ideally contain:

```text
module/
├── domain/
├── application/
├── infrastructure/
├── http/
└── index.ts
```

Do not force every module into unnecessary complexity. Small modules can
use a simpler structure while preserving boundaries.

---

# 5. Module Responsibilities

## auth

Responsible for:

- Authentication.
- Credential verification.
- Token/session lifecycle.
- Authentication context.

It should not contain organization-specific business logic.

## organizations

Responsible for:

- Organization lifecycle.
- Organization configuration.
- Tenant identification.

## users

Responsible for:

- User lifecycle.
- Organization membership.
- User status.

## roles

Responsible for:

- Roles.
- Permissions.
- Authorization policies.

## products

Responsible for:

- WymAssist.
- WymInsight.
- WymFlow.
- Product activation/entitlements.

## subscriptions

Responsible for future commercial subscription state.

Billing provider integration should remain separate.

## chatbot

Responsible for:

- Assistant configuration.
- Welcome message.
- Tone/personality configuration.
- Fallback behavior.
- Escalation configuration.
- Branding metadata.

## knowledge

Responsible for:

- FAQs.
- Knowledge articles.
- Documents.
- Knowledge lifecycle.
- Content processing state.

## retrieval

Responsible for:

- Chunking.
- Embeddings.
- Vector storage.
- Similarity search.
- Retrieval filtering.
- Organization isolation.

## ai

Responsible for:

- LLM abstraction.
- Embedding abstraction.
- Prompt/context construction.
- Provider adapters.
- AI error normalization.

## customers

Responsible for:

- Customer records.
- Contact data.
- Configurable customer information.

## conversations

Responsible for:

- Conversations.
- Messages.
- Session/channel information.

## leads

Responsible for:

- Lead creation.
- Lead lifecycle.
- Lead status.

## escalations

Responsible for:

- Human escalation.
- Assignment foundation.
- Escalation lifecycle.

## appointments

Responsible for:

- Appointment requests.
- Future calendar abstraction.

## usage

Responsible for:

- AI usage.
- Message/request usage.
- Future plan limits.

## audit

Responsible for:

- Security events.
- Administrative actions.
- Important business activity.

## notifications

Responsible for notification abstraction and delivery adapters.

## files

Responsible for:

- File metadata.
- Object storage references.
- Secure file access.
- Processing states.

## integrations

Responsible for external channels and services.

---

# 6. Multi-Tenancy Architecture

Multi-tenancy is a first-class requirement.

The initial strategy should be **shared database/shared schema with
organization-level isolation**.

Every organization-owned entity should contain:

```text
organization_id
```

Examples:

```text
knowledge_articles.organization_id
conversations.organization_id
customers.organization_id
leads.organization_id
appointments.organization_id
chatbot_configurations.organization_id
```

Some entities such as messages may derive organization ownership through
their parent conversation, but authorization must still resolve the
organization before access is granted.

---

# 7. Tenant Isolation Rule

Never trust an organization ID supplied by an untrusted client.

Bad:

```text
GET /organizations/:organizationId/leads
```

and simply querying the supplied ID.

Better:

```text
Authenticated user
      ↓
Resolve authorized organization
      ↓
Authorize resource
      ↓
Query organization-scoped data
```

For public chatbot traffic, organization identity must come from a
controlled chatbot/site configuration mechanism rather than arbitrary
access to another organization's data.

---

# 8. Database Model

Core platform entities:

```text
organizations
users
roles
permissions
user_roles
role_permissions
products
organization_products
subscriptions
plans
audit_events
usage_records
```

WymAssist entities:

```text
chatbot_configurations
knowledge_articles
faqs
knowledge_documents
knowledge_chunks
customers
customer_fields
customer_field_values
conversations
messages
leads
escalations
appointments
```

Supporting entities:

```text
files
notifications
integrations
```

---

# 9. Core Relationships

```text
Organization
 │
 ├── Users
 │
 ├── Products / Entitlements
 │
 ├── Subscription
 │
 ├── Chatbot Configuration
 │
 ├── Knowledge
 │     ├── FAQs
 │     ├── Articles
 │     └── Documents
 │
 ├── Customers
 │     └── Conversations
 │            └── Messages
 │
 ├── Leads
 │
 ├── Escalations
 │
 ├── Appointments
 │
 ├── Usage
 │
 └── Audit Events
```

---

# 10. Authentication Architecture

Authentication should be independent of authorization.

Flow:

```text
Client
  ↓
Login
  ↓
Credential verification
  ↓
Authenticated identity
  ↓
Session/access token
  ↓
Authentication middleware
  ↓
Request context
```

Request context should expose trusted identity information such as:

```ts
type AuthContext = {
  userId: string;
  organizationId?: string;
  roles: string[];
  permissions: string[];
  platformAccess: boolean;
};
```

The exact implementation can differ.

---

# 11. Authorization

Authorization should be performed in the backend.

Example:

```text
Request
  ↓
Authentication
  ↓
Permission check
  ↓
Organization check
  ↓
Resource ownership check
  ↓
Service operation
```

Never rely on:

- Frontend route protection.
- Hidden UI elements.
- Organization IDs sent by the client.
- Client-side role checks.

---

# 12. Platform-Level vs Organization-Level Users

The architecture needs two conceptual scopes.

### Platform scope

WymNet administrators can operate across organizations according to
permissions.

### Organization scope

Client users can access only their organization's data.

Example:

```text
WymNet Super Admin
    │
    ├── Organization A
    ├── Organization B
    └── Organization C
```

versus:

```text
Organization A Admin
    │
    └── Organization A only
```

The authorization layer must explicitly understand this distinction.

---

# 13. Product Entitlement Architecture

Products should be represented as data rather than hardcoded
assumptions.

```text
products
    │
    ├── WymAssist
    ├── WymInsight
    └── WymFlow
```

Organizations receive access through:

```text
organization_products
```

Example:

```text
Organization A → WymAssist → active
Organization A → WymInsight → inactive
Organization B → WymAssist → active
Organization B → WymFlow → active
```

Feature authorization can therefore be based on product entitlement.

---

# 14. WymAssist Conversation Architecture

The main conversation flow:

```text
POST message
      │
      ▼
Resolve public client/session
      │
      ▼
Resolve organization
      │
      ▼
Load conversation
      │
      ▼
Persist customer message
      │
      ▼
Load chatbot configuration
      │
      ▼
Retrieve knowledge
      │
      ▼
Build AI context
      │
      ▼
Call LLM
      │
      ▼
Validate/control response
      │
      ├──── Escalate ────► Escalation Service
      │
      ▼
Persist AI response
      │
      ▼
Record usage
      │
      ▼
Return response
```

---

# 15. Retrieval/RAG Architecture

The knowledge pipeline:

```text
FAQ / Article / Document
          │
          ▼
       Normalize
          │
          ▼
        Chunk
          │
          ▼
       Embedding
          │
          ▼
     Vector storage
```

Query pipeline:

```text
Customer question
        │
        ▼
Generate query embedding
        │
        ▼
Vector similarity search
        │
        ▼
Filter organization
        │
        ▼
Filter approved/active knowledge
        │
        ▼
Apply relevance threshold
        │
        ▼
Return relevant context
```

The retrieval layer must not know about UI concerns.

---

# 16. AI Provider Abstraction

Use interfaces similar to:

```ts
interface LLMProvider {
  generateResponse(input: GenerateResponseInput): Promise<GenerateResponseResult>;
}

interface EmbeddingProvider {
  generateEmbedding(input: string): Promise<number[]>;
}
```

The exact interface should be adapted to the selected provider.

Application code should depend on these abstractions, not provider SDK
calls.

Provider-specific code belongs in:

```text
modules/ai/infrastructure/providers/
```

---

# 17. Prompt Architecture

The AI context should conceptually be:

```text
Platform safety/instructions
        +
Organization assistant configuration
        +
Relevant conversation context
        +
Retrieved approved knowledge
        +
Current customer message
```

The system must clearly distinguish trusted instructions from untrusted
customer content and retrieved business content.

Customer content must never be allowed to override platform security
rules.

---

# 18. Grounding and Hallucination Control

The backend should implement controlled behavior:

```text
Question
  ↓
Relevant knowledge found?
  │
  ├── Yes → Generate grounded answer
  │
  └── No
       ↓
    Fallback
       ↓
    Escalation if configured/appropriate
```

The system should not present unsupported facts as confirmed
organizational information.

Retrieval confidence/relevance should be treated as an internal signal,
not as proof that an answer is correct.

---

# 19. Conversation Context

Conversation history should be used selectively.

Do not send unlimited conversation history to the LLM.

A future strategy may include:

- Recent messages.
- Conversation summary.
- Relevant historical context.

The initial MVP can use a bounded recent-message window.

---

# 20. Customer Model

A customer is organization-scoped.

Conceptually:

```text
Customer
├── organization_id
├── name
├── email
├── phone
└── metadata
```

Do not hardcode industry-specific fields.

Use configurable customer fields:

```text
customer_fields
customer_field_values
```

---

# 21. Lead Model

A lead belongs to an organization and can be associated with:

- Customer.
- Conversation.
- Source/channel.

Lifecycle:

```text
new
 ↓
contacted
 ↓
qualified
 ↓
converted
 ↓
closed
```

Not every lead must pass through every state.

---

# 22. Escalation Architecture

Escalation should not destroy or replace the AI conversation.

Instead:

```text
Conversation
     │
     └── Escalation
           ├── reason
           ├── status
           ├── assigned user
           └── timestamps
```

The complete conversation remains available.

---

# 23. Appointment Architecture

MVP:

```text
Customer
   │
Conversation
   │
Appointment Request
```

The appointment entity represents a request, not necessarily a confirmed
calendar event.

Future:

```text
Appointment Service
       │
       └── Calendar Adapter
              ├── Google
              ├── Microsoft
              └── Other provider
```

---

# 24. Public Chat API Security

The website chatbot is public-facing.

Therefore:

- Do not expose administrative endpoints.
- Do not expose arbitrary organization data.
- Validate all incoming messages.
- Limit payload size.
- Rate-limit abusive clients.
- Consider bot/abuse protection.
- Identify the intended organization securely.
- Do not trust a customer-provided organization ID.
- Return generic errors to public clients.

Public endpoints and administrative endpoints must be clearly separated.

---

# 25. API Organization

Recommended API grouping:

```text
/api/v1/auth/*
/api/v1/organizations/*
/api/v1/users/*
/api/v1/roles/*
/api/v1/products/*
/api/v1/subscriptions/*

/api/v1/chatbot/*
/api/v1/knowledge/*
/api/v1/conversations/*
/api/v1/customers/*
/api/v1/leads/*
/api/v1/escalations/*
/api/v1/appointments/*
/api/v1/usage/*
/api/v1/audit/*
```

Public chatbot endpoints may use a separate namespace:

```text
/api/v1/public/chat/*
```

Exact routes must be finalized during implementation.

---

# 26. Service Layer

Controllers should remain thin.

Example:

```text
HTTP Controller
      ↓
Application Service
      ↓
Domain logic
      ↓
Repository / provider
```

Avoid:

```text
Controller
   ↓
Huge SQL query
   ↓
LLM provider
   ↓
Business rules
```

---

# 27. Repository/Data Access

Database access should be centralized through repositories or clearly
defined data-access modules.

For organization-owned resources, repository methods should make tenant
scope explicit.

Conceptually:

```ts
findConversation({
  organizationId,
  conversationId,
});
```

rather than:

```ts
findConversation(conversationId);
```

where organization ownership is forgotten.

---

# 28. Transactions

Use database transactions when multiple related changes must succeed or
fail together.

Examples:

```text
Create lead
+
Update conversation
+
Create audit event
```

or:

```text
Persist customer message
+
Persist AI response
+
Record usage
```

The exact transaction boundaries should be determined by consistency
requirements.

---

# 29. Idempotency

Operations exposed to retries should be evaluated for idempotency.

Potential candidates:

- Public message submission.
- External webhook handling.
- Notification delivery.
- Document processing.
- Usage recording.

Do not invent idempotency behavior where it is unnecessary, but do not
ignore duplicate requests in operations where duplication can cause
incorrect business state.

---

# 30. Background Jobs

The MVP should not move every operation into a queue.

Use background jobs when:

- Document processing is expensive.
- Embedding generation is expensive.
- Notifications should be asynchronous.
- External integrations require retries.
- Report generation becomes expensive.

A future structure could be:

```text
API
 │
 ├── synchronous request
 │
 └── queue → worker → result
```

Redis/BullMQ or another job system can be evaluated when the need
exists.

---

# 31. File Processing

Documents should follow:

```text
Upload
  ↓
Validate
  ↓
Store object
  ↓
Create document record
  ↓
Queue processing
  ↓
Extract text
  ↓
Chunk
  ↓
Embed
  ↓
Store vectors
  ↓
Mark ready
```

Failures should produce an explicit processing state.

---

# 32. Audit Architecture

Audit records should contain concepts such as:

```text
organization_id
actor_user_id
action
resource_type
resource_id
timestamp
metadata
```

Examples:

```text
organization.created
user.created
user.role_changed
knowledge.created
knowledge.updated
knowledge.deleted
lead.status_changed
escalation.assigned
```

Do not store secrets in audit metadata.

---

# 33. Usage Architecture

Usage records should be independent from billing.

Conceptually:

```text
Usage Event
├── organization
├── product
├── event_type
├── quantity
├── provider metadata
└── timestamp
```

This allows future billing systems to consume usage without coupling
WymAssist to a payment provider.

---

# 34. Notifications Architecture

Use:

```text
NotificationService
       │
       ├── EmailAdapter
       ├── WhatsAppAdapter
       └── InAppAdapter
```

The WymAssist escalation service should request a notification without
knowing how the notification is delivered.

---

# 35. Integration Architecture

Future external channels should use adapters.

```text
Channel
   ↓
Integration Adapter
   ↓
Normalized Message
   ↓
Conversation Service
   ↓
WymAssist
```

For example:

```text
Website
WhatsApp
Instagram
Email
   │
   ▼
Channel Adapter
   │
   ▼
Normalized inbound message
   │
   ▼
Conversation service
```

This prevents WymAssist business logic from becoming WhatsApp-specific.

---

# 36. Future WymInsight Architecture

WymInsight should eventually be another module:

```text
Platform
  │
  ├── WymAssist
  ├── WymInsight
  └── WymFlow
```

It should reuse:

- Authentication.
- Organizations.
- Users.
- RBAC.
- Product entitlements.
- Usage.
- Audit.
- Storage.

WymInsight-specific data must remain in its own module.

Possible future modules:

```text
modules/
└── insight/
    ├── datasets/
    ├── ingestion/
    ├── analysis/
    ├── forecasting/
    └── reports/
```

Do not implement these during WymAssist MVP.

---

# 37. Future WymFlow Architecture

WymFlow should eventually be a separate module.

Possible structure:

```text
modules/
└── flow/
    ├── forms/
    ├── submissions/
    ├── workflows/
    ├── tasks/
    ├── approvals/
    ├── documents/
    └── automation/
```

Reuse platform infrastructure but keep workflow domain logic separate.

---

# 38. Deployment Architecture

Recommended initial production topology:

```text
Internet
   │
   ▼
Load Balancer / API Gateway
   │
   ▼
WymNet AI API
   │
   ├──────────────► PostgreSQL
   │
   ├──────────────► Redis
   │
   ├──────────────► Object Storage
   │
   └──────────────► AI Provider
```

Workers can be introduced later:

```text
API
 │
 ▼
Queue
 │
 ▼
Worker
 │
 ├── Document processing
 ├── Embeddings
 ├── Notifications
 └── Other asynchronous work
```

---

# 39. Environment Separation

Maintain separate configuration for:

```text
development
test
staging
production
```

Never share production secrets with development.

Required secret categories may include:

- Database credentials.
- Session/auth secrets.
- AI provider keys.
- Object-storage credentials.
- Redis credentials.
- External integration credentials.

---

# 40. Observability

Every request should have a correlation/request ID.

Logs should contain useful structured metadata:

```text
request_id
organization_id
user_id
route
status
duration
error_code
```

Do not log sensitive content unnecessarily.

AI operations should expose useful operational information such as:

- Provider.
- Model identifier where appropriate.
- Latency.
- Token/usage information where available.
- Success/failure.

Do not log full customer conversations by default merely for debugging.

---

# 41. Error Architecture

Use consistent application errors.

Conceptually:

```text
ValidationError
AuthenticationError
AuthorizationError
NotFoundError
ConflictError
RateLimitError
ExternalServiceError
AIProviderError
DatabaseError
```

HTTP mapping should be consistent.

Public errors should not expose:

- Stack traces.
- SQL.
- Internal provider errors.
- Secrets.
- Infrastructure details.

---

# 42. Validation

Every external input should be validated.

Validate:

- Request body.
- Query parameters.
- Path parameters.
- Uploaded file metadata.
- Configuration.
- Customer fields.
- AI-related request limits.

Do not rely on TypeScript types as runtime validation.

---

# 43. Testing Architecture

The most important tests are tenant-isolation tests.

Example:

```text
Organization A
    │
    └── Knowledge A

Organization B
    │
    └── Knowledge B
```

Test:

```text
Request from A
     ↓
Search knowledge
     ↓
Must NEVER return B
```

Repeat for:

- Conversations.
- Customers.
- Leads.
- Appointments.
- Files.
- Audit events.
- Usage.
- Chatbot configuration.

---

# 44. AI-Specific Security

The AI layer must distinguish:

1.  Platform instructions.
2.  Organization configuration.
3.  Approved organizational knowledge.
4.  Customer-provided content.

Customer content is untrusted input.

Retrieved knowledge is business content, not a platform authorization
mechanism.

A retrieved document must never be able to instruct the backend to:

- Reveal secrets.
- Bypass authorization.
- Access another tenant.
- Execute arbitrary commands.
- Modify platform security.

---

# 45. Data Retention

Retention requirements should be configurable later.

The architecture should not assume that conversation data is retained
forever.

Potential future policies:

- Conversation retention.
- Audit retention.
- Document retention.
- Customer-data deletion.
- Organization deletion.

Deletion should consider related records and legal/operational
requirements.

---

# 46. API Contract Stability

Once public APIs are used by customer websites, breaking changes become
costly.

Therefore:

- Version APIs.
- Avoid unnecessary breaking changes.
- Use explicit request/response schemas.
- Deprecate rather than silently change behavior.
- Maintain OpenAPI documentation.
- Add integration tests for important public endpoints.

---

# 47. Recommended Implementation Sequence

```text
Phase 1
Foundation
    ↓
Phase 2
Identity + Tenancy
    ↓
Phase 3
Products + Entitlements
    ↓
Phase 4
WymAssist Configuration
    ↓
Phase 5
Knowledge
    ↓
Phase 6
Retrieval
    ↓
Phase 7
AI Provider
    ↓
Phase 8
Conversations
    ↓
Phase 9
End-to-End AI
    ↓
Phase 10
Customers + Leads
    ↓
Phase 11
Escalation + Appointments
    ↓
Phase 12
Public Chat API
    ↓
Phase 13
Usage + Audit
    ↓
Phase 14
Security Hardening
    ↓
Phase 15
Testing
    ↓
Phase 16
Observability + Deployment
```

---

# 48. Architecture Decision Records

Important decisions should be recorded in:

```text
docs/architecture/decisions/
```

Examples:

```text
ADR-001-modular-monolith.md
ADR-002-multi-tenancy-strategy.md
ADR-003-vector-storage.md
ADR-004-ai-provider-abstraction.md
ADR-005-authentication-strategy.md
ADR-006-public-chat-security.md
```

An ADR should explain:

- Problem.
- Options considered.
- Decision.
- Reason.
- Consequences.

---

# 49. Backend Repository Recommendation

A possible repository:

```text
wymnet-ai-backend/
│
├── src/
│   ├── core/
│   │
│   ├── modules/
│   │
│   ├── app.ts
│   └── server.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── drizzle/
│   └── migrations/
│
├── docs/
│   └── architecture/
│
├── scripts/
│
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

The AI developer should inspect the existing repository before creating
a new structure if a backend repository already exists.

---

# 50. Rules for AI-Assisted Development

The AI developer must:

- Inspect the existing code before changing architecture.
- Reuse existing working infrastructure where appropriate.
- Never delete working functionality without justification.
- Never assume an API contract that has not been verified.
- Never invent external provider documentation.
- Keep modules isolated.
- Keep tenant filtering explicit.
- Add tests with important features.
- Run migrations safely.
- Avoid destructive database operations.
- Explain breaking changes.
- Update documentation after significant architectural changes.
- Keep future-product scaffolding minimal.
- Avoid introducing microservices unless there is a concrete
  requirement.
- Avoid adding dependencies without a reason.
- Verify generated code by running type checks/tests.

---

# 51. Definition of Architectural Success

The architecture is successful when the following can be true
simultaneously:

```text
                    WymNet AI Platform
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      WymAssist        WymInsight        WymFlow
          │
     Organization A
          │
     Organization B
          │
     Organization C
```

without:

- Creating separate applications per organization.
- Copying backend code per client.
- Sharing knowledge between tenants.
- Coupling future products to WymAssist.
- Coupling AI logic to one provider.
- Coupling channel logic to one communication platform.

---

# 52. Immediate Implementation Target

Do not begin with WhatsApp, billing, WymInsight, WymFlow, advanced
analytics, or frontend APIs beyond what is necessary for the website
chat contract.

The first backend target is:

```text
Organization
   ↓
User
   ↓
Authentication
   ↓
WymAssist entitlement
   ↓
Knowledge
   ↓
Retrieval
   ↓
AI provider
   ↓
Conversation
   ↓
Message
   ↓
Grounded response
```

Once this path works reliably, add:

```text
Customer
   ↓
Lead
   ↓
Escalation
   ↓
Appointment
```

Then:

```text
Usage
Audit
Security hardening
Testing
Deployment
```

This sequence minimizes wasted work while preserving the long-term
WymNet AI platform architecture.

---

# 53. Knowledge Processing (Phase 4)

Pipeline:

```text
Knowledge Management (TEXT/PDF)
        ↓
Source retrieval (DB for TEXT, storage for PDF)
        ↓
Extraction (pdf-parse for PDF)
        ↓
Normalization (whitespace/newlines)
        ↓
Chunking (char-based, overlap)
        ↓
Persist chunks (knowledge_chunks)
```

Processing lifecycle on `knowledge_items`:

```text
PENDING → PROCESSING → COMPLETED
                 ↘︎
                 FAILED (processing_error populated)
```

Chunk model:

```text
knowledge_chunks
├── id
├── organization_id (FK)
├── knowledge_item_id (FK)
├── content (text)
├── chunk_index (deterministic order)
├── metadata (JSON string; sourceType/pageNumber/filename/category when applicable)
├── created_at
└── updated_at
```

Strategy:

- Deterministic character-based chunking with small overlap.
- Paragraph/newline normalization to avoid mid-word splits.
- No tokenizers or embeddings in this phase.

PDF extraction:

- Library: `pdf-parse` (server-friendly, no external service).
- Pages: page breaks detected via form-feed; per-chunk metadata includes `pageNumber` and `filename`.
- OCR is explicitly out of scope; empty/scanned PDFs fail with `FAILED`.

Reprocessing:

- Deletes prior chunks for the item before inserting new ones.
- Marks item `PROCESSING` during work; on success `COMPLETED`, on failure `FAILED` with `processing_error`.
- Audit events: `knowledge.processing.started/completed/failed/reprocessed`.

Security and isolation:

- All operations resolve `organizationId` from `AuthContext`.
- Chunks are written with `organization_id`; queries are tenant-filtered.
- Processing endpoint is protected by RBAC (`knowledge.write`) and WymAssist entitlement.
- PDF reads from internal storage only; uploaded files are never executed.

Phase boundary:

- No embeddings, vector storage, semantic retrieval, or LLM calls implemented here.
- Output is persisted chunks + metadata suitable for future retrieval/citation.

---

# 54. Knowledge Retrieval (Phase 5)

Provider and configuration:

- Embedding provider: LOCAL deterministic embedding (no external API) for MVP.
- Env: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `RETRIEVAL_TOPK`, `RETRIEVAL_MIN_SCORE`.
- Future: swap provider and migrate embeddings to pgvector without changing RetrievalService API.

Storage:

- `knowledge_chunks` extended with embedding fields (`embedding`, `embedding_status`, `embedding_model`, `embedding_dim`, `content_hash`).
- Initially stores JSON arrays; future migration to pgvector recommended.

Embedding pipeline:

```text
Phase 4 chunks → mark embedding PENDING → generate → store → status COMPLETED/FAILED
```

Retrieval service:

```text
retrieveRelevantKnowledge({ organizationId, query, topK, minScore, filters? })
  ↓
Compute query embedding
  ↓
Database candidates (organization_id + ACTIVE status)
  ↓
Cosine similarity (in app for JSON vectors)
  ↓
Rank, threshold, topK
  ↓
Return results { chunkId, knowledgeItemId, content, score, metadata }
```

Tenant isolation and authorization:

- All retrieval is filtered by `organization_id` in the DB query.
- API requires authentication, `knowledge.read`, and WymAssist entitlement.

Parameters and limits:

- `topK` and `minScore` configurable (defaults from env).
- Future: add max context size and additional metadata filters.

Boundary:

- Retrieval returns evidence only (no LLM calls, no semantic generation).
- Phase 6 will consume retrieval results to build AI responses.

---

# 55. AI Conversation Service (Phase 6)

Overview:

- Provider-independent LLM layer with `LLMProvider` and `getLLMProvider()`.
- `PromptBuilder` constructs stable, secure prompts with system rules and bounded retrieved context.
- `AIConversationService.generateResponse()` orchestrates entitlement, retrieval, prompt, LLM call, validation, and response shaping.

Configuration (env):

- `AI_PROVIDER` (default LOCAL_FAKE)
- `AI_MODEL` (default local-fake)
- `AI_TEMPERATURE`, `AI_MAX_OUTPUT_TOKENS`
- `AI_MAX_CHUNKS`, `AI_MAX_CONTEXT_CHARS`
- `AI_FALLBACK_MESSAGE`

Flow:

```text
Request { organizationId, message, conversationContext? }
  ↓
Entitlement & auth (RBAC knowledge.read + WymAssist)
  ↓
Phase 5 retrieval (org-scoped, ACTIVE)
  ↓
PromptBuilder: system + bounded retrieved context + message
  ↓
LLM provider
  ↓
Validate & shape response { message, grounded, sources, usage }
```

Security and grounding:

- Retrieval-first; Phase 6 never bypasses Phase 5 for org-specific info.
- Instruction hierarchy: system > app > user/docs; ignore prompt injections in docs/user.
- Never expose private/internal data or other org data.

API:

- `POST /api/v1/ai/respond` (auth + `knowledge.read` + WymAssist entitlement)

Failure handling:

- Distinguish retrieval no-results vs LLM failure; return friendly fallback for LLM errors.

<!-- Ignore this comment, I am just trying to test somethings in my live repo, this is just to see if the user application for this article is well sorted, I am also testing my typing speed as regards development in general, the need to always justify  -->
