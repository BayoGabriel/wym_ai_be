import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  pgEnum,
  boolean,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core';

export const orgStatusEnum = pgEnum('org_status', ['pending', 'active', 'suspended', 'archived']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended']);
export const roleScopeEnum = pgEnum('role_scope', ['platform', 'organization']);
export const orgProductStatusEnum = pgEnum('org_product_status', ['active', 'inactive']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'suspended',
  'cancelled',
  'expired',
]);

export const knowledgeSourceEnum = pgEnum('knowledge_source', ['TEXT', 'PDF']);
export const knowledgeStatusEnum = pgEnum('knowledge_status', ['DRAFT', 'ACTIVE', 'ARCHIVED']);
export const knowledgeCategoryEnum = pgEnum('knowledge_category', [
  'FAQ',
  'EVENTS',
  'FEATURES',
  'GENERAL',
]);
export const processingStatusEnum = pgEnum('processing_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export const embeddingStatusEnum = pgEnum('embedding_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export const conversationStatusEnum = pgEnum('conversation_status', [
  'ACTIVE',
  'CLOSED',
  'ARCHIVED',
]);
export const conversationChannelEnum = pgEnum('conversation_channel', ['WEB', 'API']);
export const messageRoleEnum = pgEnum('message_role', ['USER', 'ASSISTANT', 'SYSTEM', 'AGENT']);
export const leadStatusEnum = pgEnum('lead_status', [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'CONVERTED',
  'LOST',
]);
export const handoffStatusEnum = pgEnum('handoff_status', [
  'REQUESTED',
  'QUEUED',
  'ASSIGNED',
  'RESOLVED',
  'CANCELLED',
]);
export const handoffRequestedByEnum = pgEnum('handoff_requested_by', [
  'VISITOR',
  'STAFF',
  'SYSTEM',
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  status: orgStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  status: userStatusEnum('status').notNull().default('active'),
  organizationId: uuid('organization_id').references(() => organizations.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  scope: roleScopeEnum('scope').notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id')
    .references(() => roles.id)
    .notNull(),
  permissionId: uuid('permission_id')
    .references(() => permissions.id)
    .notNull(),
});

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  roleId: uuid('role_id')
    .references(() => roles.id)
    .notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationProducts = pgTable(
  'organization_products',
  {
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    productId: uuid('product_id')
      .references(() => products.id)
      .notNull(),
    status: orgProductStatusEnum('status').notNull().default('inactive'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    org_product_unique: unique('org_product_unique').on(t.organizationId, t.productId),
  })
);

export const organizationSettings = pgTable('organization_settings', {
  organizationId: uuid('organization_id')
    .references(() => organizations.id)
    .notNull(),
  businessName: varchar('business_name', { length: 255 }),
  businessCategory: varchar('business_category', { length: 255 }),
  website: varchar('website', { length: 512 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 64 }),
  address: text('address'),
  timezone: varchar('timezone', { length: 64 }),
  defaultLanguage: varchar('default_language', { length: 16 }),
  active: boolean('active').notNull().default(true),
  logoUrl: varchar('logo_url', { length: 1024 }),
  primaryColor: varchar('primary_color', { length: 16 }),
  secondaryColor: varchar('secondary_color', { length: 16 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assistantConfigurations = pgTable('assistant_configurations', {
  organizationId: uuid('organization_id')
    .references(() => organizations.id)
    .notNull(),
  assistantName: varchar('assistant_name', { length: 255 }),
  welcomeMessage: text('welcome_message'),
  businessDescription: text('business_description'),
  tone: varchar('tone', { length: 64 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 64 }),
  operatingHours: text('operating_hours'),
  escalationEnabled: boolean('escalation_enabled').notNull().default(false),
  leadCaptureEnabled: boolean('lead_capture_enabled').notNull().default(false),
  appointmentRequestsEnabled: boolean('appointment_requests_enabled').notNull().default(false),
  publicChatEnabled: boolean('public_chat_enabled').notNull().default(false),
  allowedOrigins: text('allowed_origins'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  action: varchar('action', { length: 255 }).notNull(),
  resourceType: varchar('resource_type', { length: 255 }),
  resourceId: varchar('resource_id', { length: 255 }),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  productId: uuid('product_id').references(() => products.id),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  quantity: integer('quantity').notNull().default(1),
  provider: varchar('provider', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeItems = pgTable('knowledge_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .references(() => organizations.id)
    .notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  content: text('content'),
  sourceType: knowledgeSourceEnum('source_type').notNull(),
  status: knowledgeStatusEnum('status').notNull().default('DRAFT'),
  category: knowledgeCategoryEnum('category').notNull().default('GENERAL'),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  processingStatus: processingStatusEnum('processing_status').notNull().default('PENDING'),
  processingError: text('processing_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  knowledgeItemId: uuid('knowledge_item_id')
    .references(() => knowledgeItems.id)
    .notNull(),
  originalFilename: varchar('original_filename', { length: 512 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  fileSize: integer('file_size').notNull(),
  storageKey: varchar('storage_key', { length: 1024 }).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .references(() => organizations.id)
    .notNull(),
  knowledgeItemId: uuid('knowledge_item_id')
    .references(() => knowledgeItems.id)
    .notNull(),
  content: text('content').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  metadata: text('metadata'),
  // Phase 5 embedding fields (initially JSON text; can be migrated to pgvector later)
  embedding: text('embedding'),
  embeddingStatus: embeddingStatusEnum('embedding_status').notNull().default('PENDING'),
  embeddingError: text('embedding_error'),
  embeddingModel: varchar('embedding_model', { length: 128 }),
  embeddingDim: integer('embedding_dim'),
  contentHash: varchar('content_hash', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .references(() => organizations.id)
    .notNull(),
  productId: uuid('product_id')
    .references(() => products.id)
    .notNull(),
  status: subscriptionStatusEnum('status').notNull().default('trialing'),
  startAt: timestamp('start_at', { withTimezone: true }).notNull().defaultNow(),
  endAt: timestamp('end_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    status: conversationStatusEnum('status').notNull().default('ACTIVE'),
    channel: conversationChannelEnum('channel').notNull().default('API'),
    externalSessionId: varchar('external_session_id', { length: 255 }),
    title: varchar('title', { length: 255 }),
    metadata: text('metadata'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    org_created_idx: index('conversations_org_created_idx').on(t.organizationId, t.createdAt),
    org_status_idx: index('conversations_org_status_idx').on(t.organizationId, t.status),
    org_external_session_unique: unique('conversations_org_external_session_unique').on(
      t.organizationId,
      t.externalSessionId
    ),
  })
);

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: varchar('key', { length: 512 }).primaryKey(),
  hits: integer('hits').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id)
      .notNull(),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    visitorLabel: varchar('visitor_label', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    token_hash_unique: unique('chat_sessions_token_hash_unique').on(t.tokenHash),
    conversation_unique: unique('chat_sessions_conversation_unique').on(t.conversationId),
    org_idx: index('chat_sessions_org_idx').on(t.organizationId),
    expires_idx: index('chat_sessions_expires_idx').on(t.expiresAt),
  })
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id),
    chatSessionId: uuid('chat_session_id').references(() => chatSessions.id),
    name: varchar('name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 64 }),
    enquiryCategory: varchar('enquiry_category', { length: 64 }),
    summary: varchar('summary', { length: 1000 }),
    status: leadStatusEnum('status').notNull().default('NEW'),
    source: varchar('source', { length: 64 }).notNull().default('PUBLIC_CHAT'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    consentToContact: boolean('consent_to_contact').notNull().default(false),
    clientRequestId: varchar('client_request_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    org_created_idx: index('leads_org_created_idx').on(t.organizationId, t.createdAt),
    org_status_idx: index('leads_org_status_idx').on(t.organizationId, t.status),
    org_assignee_idx: index('leads_org_assignee_idx').on(t.organizationId, t.assignedTo),
    conv_request_unique: unique('leads_conv_client_request_unique').on(
      t.conversationId,
      t.clientRequestId
    ),
    session_idx: index('leads_session_idx').on(t.chatSessionId),
  })
);

export const leadNotes = pgTable(
  'lead_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .references(() => leads.id)
      .notNull(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    authorUserId: uuid('author_user_id')
      .references(() => users.id)
      .notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lead_idx: index('lead_notes_lead_idx').on(t.leadId),
    org_idx: index('lead_notes_org_idx').on(t.organizationId),
  })
);

export const handoffs = pgTable(
  'handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id)
      .notNull(),
    chatSessionId: uuid('chat_session_id').references(() => chatSessions.id),
    status: handoffStatusEnum('status').notNull().default('QUEUED'),
    requestedBy: handoffRequestedByEnum('requested_by').notNull().default('VISITOR'),
    reason: varchar('reason', { length: 500 }),
    assignedTo: uuid('assigned_to').references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionSummary: varchar('resolution_summary', { length: 1000 }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: varchar('cancellation_reason', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    org_created_idx: index('handoffs_org_created_idx').on(t.organizationId, t.createdAt),
    org_status_idx: index('handoffs_org_status_idx').on(t.organizationId, t.status),
    org_assignee_idx: index('handoffs_org_assignee_idx').on(t.organizationId, t.assignedTo),
    session_idx: index('handoffs_session_idx').on(t.chatSessionId),
    conv_idx: index('handoffs_conv_idx').on(t.conversationId),
  })
);

export const handoffNotes = pgTable(
  'handoff_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handoffId: uuid('handoff_id')
      .references(() => handoffs.id)
      .notNull(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    authorUserId: uuid('author_user_id')
      .references(() => users.id)
      .notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    handoff_idx: index('handoff_notes_handoff_idx').on(t.handoffId),
    org_idx: index('handoff_notes_org_idx').on(t.organizationId),
  })
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id)
      .notNull(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    clientRequestId: varchar('client_request_id', { length: 128 }),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conv_created_idx: index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    org_created_idx: index('messages_org_created_idx').on(t.organizationId, t.createdAt),
    conv_request_unique: unique('messages_conv_client_request_unique').on(
      t.conversationId,
      t.clientRequestId
    ),
  })
);
