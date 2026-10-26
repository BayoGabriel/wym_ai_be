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
