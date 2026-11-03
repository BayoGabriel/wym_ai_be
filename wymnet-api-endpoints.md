# WymNet AI Backend API — Endpoint Reference

Base URL variable: `{{base_url}}`
Auth variables: `{{access_token}}`, `{{refresh_token}}`

---

## System

### Health Check

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/health`
- **Headers:** none

### Root

- **Method:** `GET`
- **URL:** `{{base_url}}/`
- **Headers:** none

---

## AI

### AI Respond

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/ai/respond`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`
  - `Content-Type: application/json`
- **Body (raw JSON):**

```json
{
  "message": "What services do you offer?"
}
```

---

## Authentication

### Login

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/auth/login`
- **Headers:**
  - `Content-Type: application/json`
- **Body (raw JSON):**

```json
{
  "email": "admin@example.com",
  "password": "SecurePass123"
}
```

### Refresh Token

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/auth/refresh`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "refreshToken": "{{refresh_token}}"
}
```

### Logout

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/auth/logout`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "refreshToken": "{{refresh_token}}"
}
```

### Me

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/auth/me`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

---

## Organizations

### List Organizations

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/organizations`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Create Organization

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/organizations`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "name": "Client Corp",
  "slug": "client-corp",
  "status": "active"
}
```

### Get Organization

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/organizations/{{organization_id}}`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Update Organization

- **Method:** `PATCH`
- **URL:** `{{base_url}}/api/v1/organizations/{{organization_id}}`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "status": "suspended"
}
```

---

## Users

### List Users

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/users`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Create User

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/users`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "email": "staff@client-corp.com",
  "name": "Jane Staff",
  "password": "SecurePass123",
  "organizationId": "{{organization_id}}",
  "status": "active"
}
```

### Get User

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/users/{{user_id}}`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Update User

- **Method:** `PATCH`
- **URL:** `{{base_url}}/api/v1/users/{{user_id}}`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "status": "suspended"
}
```

---

## RBAC

### List Roles

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/roles`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### List Permissions

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/permissions`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

---

## Organization Settings

### Get Settings

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/organizations/settings`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Update Settings

- **Method:** `PATCH`
- **URL:** `{{base_url}}/api/v1/organizations/settings`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "businessName": "Client Corp",
  "timezone": "America/New_York",
  "defaultLanguage": "en"
}
```

---

## Assist Configuration

### Get Assist Config

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/assist`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Update Assist Config

- **Method:** `PATCH`
- **URL:** `{{base_url}}/api/v1/assist`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "assistantName": "Wymie",
  "welcomeMessage": "Hi! How can I help?",
  "tone": "friendly",
  "leadCaptureEnabled": true
}
```

---

## Admin / Products

### List Products

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/admin/products`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Create Product

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/admin/products`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "name": "New Product",
  "code": "NEWPROD",
  "description": "Description",
  "active": true
}
```

### Assign Product to Organization

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/admin/products/assign`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "organizationId": "{{organization_id}}",
  "productCode": "WYMASSIST",
  "status": "active"
}
```

---

## Knowledge

### List Knowledge

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/knowledge?category=GENERAL&status=ACTIVE&page=1&limit=10`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`
- **Query Params:**
  - `category = GENERAL`
  - `status = ACTIVE`
  - `page = 1`
  - `limit = 10`

### Create Text Knowledge

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/knowledge`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "title": "Business Hours",
  "description": "Support availability",
  "content": "We are open Mon-Fri 8-5.",
  "category": "GENERAL",
  "status": "DRAFT"
}
```

### Get Knowledge

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/knowledge/{{knowledge_id}}`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Update Knowledge

- **Method:** `PATCH`
- **URL:** `{{base_url}}/api/v1/knowledge/{{knowledge_id}}`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "status": "ACTIVE"
}
```

### Archive Knowledge

- **Method:** `DELETE`
- **URL:** `{{base_url}}/api/v1/knowledge/{{knowledge_id}}`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Upload PDF Knowledge

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/knowledge/documents`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{access_token}}`
- **Body (raw JSON):**

```json
{
  "title": "Company Handbook",
  "description": "2024 edition",
  "category": "GENERAL",
  "fileName": "handbook.pdf",
  "mimeType": "application/pdf",
  "base64": "{{pdf_base64}}"
}
```

### Process Knowledge

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/knowledge/{{knowledge_id}}/process`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`
  - `Content-Type: application/json`
- **Body:** none

### Retrieve Knowledge (Semantic)

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/knowledge/retrieve`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`
  - `Content-Type: application/json`
- **Body (raw JSON):**

```json
{
  "query": "What services do you offer?",
  "topK": 5
}
```

---

## Conversations

### Create Conversation

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/conversations`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`
  - `Content-Type: application/json`
- **Body (raw JSON):**

```json
{
  "channel": "API",
  "externalSessionId": "session-001",
  "title": "Support chat",
  "metadata": {
    "locale": "en"
  }
}
```

### List Conversations

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/conversations?page=1&limit=20&status=ACTIVE&order=desc`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Get Conversation

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/conversations/{{conversation_id}}`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Update Conversation

- **Method:** `PATCH`
- **URL:** `{{base_url}}/api/v1/conversations/{{conversation_id}}`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`
  - `Content-Type: application/json`
- **Body (raw JSON):**

```json
{
  "status": "CLOSED",
  "title": "Resolved chat",
  "metadata": {
    "resolution": "self-service"
  }
}
```

### List Conversation Messages

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/conversations/{{conversation_id}}/messages?page=1&limit=50`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`

### Create User Message + AI Reply

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/conversations/{{conversation_id}}/messages`
- **Headers:**
  - `Authorization: Bearer {{access_token}}`
  - `Content-Type: application/json`
- **Body (raw JSON):**

```json
{
  "content": "What time do you close?",
  "clientRequestId": "req-2026-10-06-01"
}
```

## Public Widget API (`/api/v1/public/assist`)

Unauthenticated endpoints used by the embeddable widget (`wymassist.js`).
Visitor session endpoints require `Authorization: Bearer wymcs_...` (the
`sessionToken` returned by session creation).

### Get Public Assistant Config

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/public/assist/config?organizationSlug={{org_slug}}`
- Returns branding, welcome copy, feature flags and intake-field definitions.
  Origin-checked against the org's `allowedOrigins`.

### Create Chat Session

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/public/assist/sessions`
- **Body:** `{ "organizationSlug": "acme", "visitorName": "Jane" }`
- Returns `sessionToken` (sent as `Bearer` on all subsequent calls).

### Send Visitor Message (→ AI reply)

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/public/assist/messages`
- **Body:** `{ "content": "Do you offer boarding?", "clientRequestId": "w-001" }`

### List Messages

- **Method:** `GET`
- **URL:** `{{base_url}}/api/v1/public/assist/messages?limit=100`

### Capture Lead

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/public/assist/leads`
- **Body:** `{ "name": "Jane", "email": "j@x.com", "phone": "+234...", "customFields": {"course":"Nursing"}, "consentToContact": true }`
- `customFields` is validated against the org's configured intake fields.

### Request Human Handoff / Poll Status

- **Method:** `POST` / `GET` — `{{base_url}}/api/v1/public/assist/handoff`
- **Body (POST):** `{ "reason": "Need pricing details" }`

### Request Appointment

- **Method:** `POST`
- **URL:** `{{base_url}}/api/v1/public/assist/appointments`
- **Body:** `{ "customerName": "Jane", "preferredDate": "2026-11-01", "preferredTime": "10:30", "reason": "Admissions visit" }`

## Appointments (staff)

Authenticated, org-scoped, `appointment.read`/`appointment.write`.

- `GET {{base_url}}/api/v1/appointments?status=REQUESTED&page=1`
- `GET {{base_url}}/api/v1/appointments/{{id}}`
- `PATCH {{base_url}}/api/v1/appointments/{{id}}` — `status` transitions
  (`CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`), `assignedToUserId`, `internalNotes`.

## Leads (staff)

- `GET {{base_url}}/api/v1/leads?status=NEW`
- `GET {{base_url}}/api/v1/leads/{{id}}` / `PATCH {{base_url}}/api/v1/leads/{{id}}`
- `POST {{base_url}}/api/v1/leads/{{id}}/notes`

## Handoffs (staff)

- `GET {{base_url}}/api/v1/handoffs?status=QUEUED`
- `GET {{base_url}}/api/v1/handoffs/{{id}}`
- `POST {{base_url}}/api/v1/handoffs/{{id}}/claim` / `/assign` / `/resolve` / `/cancel`
- `POST {{base_url}}/api/v1/handoffs/{{id}}/replies` — staff reply into the visitor thread
- `POST {{base_url}}/api/v1/handoffs/{{id}}/notes`

## Reports

- `GET {{base_url}}/api/v1/reports/enquiries?days=30` — `report.read`.
  Conversation/message/lead/handoff/appointment totals + daily message volume.

## Platform Admin (`/api/v1/admin`, `platform.manage`)

- `GET {{base_url}}/api/v1/organizations` — all client orgs (platform users see every org)
- `POST {{base_url}}/api/v1/organizations` — create a client org (`organization.create`)
- `PATCH {{base_url}}/api/v1/organizations/{{id}}` — org fields (`organization.update`)
- `POST {{base_url}}/api/v1/admin/organizations/{{id}}/status` — `{"status": "active"|"suspended"}` suspend/activate a client
- `GET {{base_url}}/api/v1/admin/subscriptions` / `POST` / `PATCH /{{id}}`
- `GET {{base_url}}/api/v1/admin/usage` — platform-wide usage totals
- `GET {{base_url}}/api/v1/admin/audit-events?limit=50` — platform audit feed

## WhatsApp Channel (scaffold)

- `GET {{base_url}}/api/v1/webhooks/whatsapp` — Meta verification handshake
- `POST {{base_url}}/api/v1/webhooks/whatsapp` — inbound messages; resolves the org
  via the `whatsappPhoneNumberId` org setting, reuses the conversation pipeline.
- Outbound replies send via `WHATSAPP_ACCESS_TOKEN` when configured; without
  credentials inbound messages are stored and visible in the dashboard only.

## WymInsight AI (staff)

Authenticated, org-scoped, requires `WYMINSIGHT` entitlement + `insight.read`/`insight.write`.

- `POST {{base_url}}/api/v1/insight/datasets` — upload `{name, filename, contentBase64}` (`.csv` or `.xlsx`, ≤8MB); profiles columns on ingest
- `GET {{base_url}}/api/v1/insight/datasets` / `GET /:id` / `DELETE /:id`
- `POST {{base_url}}/api/v1/insight/datasets/:id/analyze` — runs column stats, KPI extraction, trend detection + LLM executive summary; returns the stored report
- `GET {{base_url}}/api/v1/insight/reports?datasetId=` / `GET /:id`
- `GET {{base_url}}/api/v1/insight/reports/:id/download` — CSV export of KPIs, column stats and trend tables

## WymFlow AI (staff)

Authenticated, org-scoped, requires `WYMFLOW` entitlement.

### Workflow definitions (`flow.admin` to create/update, `flow.read` to view)

- `POST/GET/PATCH {{base_url}}/api/v1/flow/definitions[/:id]`
- Definition body: `{name, description, fields:[{key,label,type,required,options?}], steps:[{name,description?}], active}`
- Submissions are validated against `fields`; `steps` are the ordered approval chain.

### Submissions (`flow.write` to submit/cancel, `flow.read` to view)

- `POST {{base_url}}/api/v1/flow/instances` — `{definitionId, title, data, documents:[{filename,contentBase64}]}`
- `GET {{base_url}}/api/v1/flow/instances?status=&definitionId=` / `GET /:id` (includes tasks + activity timeline)
- `POST {{base_url}}/api/v1/flow/instances/:id/cancel`

### Approval tasks (`flow.write` to decide, `flow.admin` to reassign)

- `GET {{base_url}}/api/v1/flow/tasks?mine=true&status=PENDING`
- `POST {{base_url}}/api/v1/flow/tasks/:id/approve` / `/reject` — `{note?}`; approve advances to the next step, reject completes the instance as REJECTED
- `POST {{base_url}}/api/v1/flow/tasks/:id/assign` — `{assignedTo}` or null to return to the shared queue
- `POST {{base_url}}/api/v1/flow/reminders/dispatch` — platform-only sweep that notifies on stale pending tasks (call from a scheduler)
