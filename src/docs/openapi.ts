// OpenAPI 3 specification for the WymNet AI backend.
// Served by swagger-ui at /api/docs (raw JSON at /api/docs.json).
// Keep in sync with the route modules under src/modules and src/routes.

type PathItem = Record<string, unknown>;
type Paths = Record<string, PathItem>;

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object' },
      },
    },
  },
} as const;

const ERR = (desc: string) => ({
  description: desc,
  content: { 'application/json': { schema: errorSchema } },
});

function op(params: {
  tags: string[];
  summary: string;
  description?: string;
  auth?: boolean;
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}): PathItem {
  const responses = params.responses ?? {
    '200': { description: 'Success' },
    '400': ERR('Validation error'),
    '401': ERR('Unauthorized'),
    '403': ERR('Forbidden — insufficient permission or product entitlement'),
  };
  const o: PathItem = {
    tags: params.tags,
    summary: params.summary,
    ...(params.description ? { description: params.description } : {}),
    ...(params.parameters ? { parameters: params.parameters } : {}),
    ...(params.requestBody ? { requestBody: params.requestBody } : {}),
    responses,
  };
  // Docs are intentionally unauthenticated — no per-operation lock/security
  // markers. auth flags stay on call sites to document which routes need a
  // token, but nothing is emitted to the spec.
  return o;
}

const json = (schema: unknown, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

const str = (extra: Record<string, unknown> = {}) => ({ type: 'string', ...extra });
const uuid = () => ({ type: 'string', format: 'uuid' });
const int = (extra: Record<string, unknown> = {}) => ({ type: 'integer', ...extra });
const bool = (extra: Record<string, unknown> = {}) => ({ type: 'boolean', ...extra });
const en = (values: string[]) => ({ type: 'string', enum: values });

const q = (name: string, schema: unknown, description?: string, required = false) => ({
  name,
  in: 'query',
  required,
  schema,
  ...(description ? { description } : {}),
});
const p = (name: string, description: string, schema: unknown = uuid()) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema,
});

const pageParams = [
  q('page', int({ default: 1, minimum: 1 })),
  q('limit', int({ default: 20, minimum: 1, maximum: 100 })),
  q('order', en(['asc', 'desc'])),
];

const tokenPair = obj({
  accessToken: str(),
  refreshToken: str(),
});

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'];
const HANDOFF_STATUSES = ['REQUESTED', 'QUEUED', 'ASSIGNED', 'RESOLVED', 'CANCELLED'];
const APPT_STATUSES = ['REQUESTED', 'CONFIRMED', 'DECLINED', 'COMPLETED', 'CANCELLED'];
const TASK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const CONV_STATUSES = ['ACTIVE', 'CLOSED', 'ARCHIVED'];
const CHANNELS = ['WEB', 'API', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM', 'TELEGRAM', 'EMAIL'];

const paths: Paths = {
  // ── Root & health ──────────────────────────────────────────────────────────
  '/': {
    get: op({
      tags: ['System'],
      summary: 'Service info',
      auth: false,
      responses: { '200': { description: 'Service name and status' } },
    }),
  },
  '/api/v1/health': {
    get: op({
      tags: ['System'],
      summary: 'Health check',
      auth: false,
      responses: { '200': { description: 'Service is healthy' } },
    }),
  },

  // ── Auth ───────────────────────────────────────────────────────────────────
  '/api/v1/auth/register': {
    post: op({
      tags: ['Auth'],
      summary: 'Register a new organization and admin user',
      auth: false,
      requestBody: json(
        obj(
          {
            email: str({ format: 'email' }),
            password: str({ minLength: 8 }),
            name: str({ minLength: 1 }),
            organizationName: str({ minLength: 1 }),
            organizationSlug: str({ pattern: '^[a-z0-9-]+$', minLength: 3 }),
          },
          ['email', 'password', 'name', 'organizationName']
        )
      ),
      responses: {
        '201': { description: 'Created — returns org, user, and token pair' },
        '400': ERR('Validation error'),
        '409': ERR('Email or organization slug already exists'),
      },
    }),
  },
  '/api/v1/auth/login': {
    post: op({
      tags: ['Auth'],
      summary: 'Log in with email and password',
      auth: false,
      requestBody: json(
        obj({ email: str({ format: 'email' }), password: str({ minLength: 8 }) }, [
          'email',
          'password',
        ])
      ),
      responses: {
        '200': { description: 'Token pair', content: { 'application/json': { schema: tokenPair } } },
        '400': ERR('Validation error'),
        '401': ERR('Invalid credentials'),
        '403': ERR('User is not active'),
      },
    }),
  },
  '/api/v1/auth/refresh': {
    post: op({
      tags: ['Auth'],
      summary: 'Rotate a refresh token',
      description: 'Requires the (possibly expired) access token in the Authorization header.',
      requestBody: json(obj({ refreshToken: str({ minLength: 20 }) }, ['refreshToken'])),
      responses: {
        '200': { description: 'New token pair' },
        '401': ERR('Invalid access or refresh token'),
      },
    }),
  },
  '/api/v1/auth/logout': {
    post: op({
      tags: ['Auth'],
      summary: 'Revoke a refresh token',
      requestBody: json(obj({ refreshToken: str({ minLength: 20 }) }, ['refreshToken'])),
      responses: { '204': { description: 'Revoked' }, '401': ERR('Invalid token') },
    }),
  },
  '/api/v1/auth/me': {
    get: op({
      tags: ['Auth'],
      summary: 'Current user, roles, and permissions',
      responses: {
        '200': {
          description: 'User context',
          content: {
            'application/json': {
              schema: obj({
                id: uuid(),
                email: str(),
                name: str(),
                status: str(),
                organizationId: uuid(),
                roles: { type: 'array', items: { type: 'object' } },
                permissions: { type: 'array', items: str() },
                platformAccess: bool(),
              }),
            },
          },
        },
        '401': ERR('Unauthorized'),
      },
    }),
  },

  // ── Organizations & settings ──────────────────────────────────────────────
  '/api/v1/organizations': {
    get: op({
      tags: ['Organizations'],
      summary: 'List organizations',
      description: 'Platform scope: list all client organizations (platform.manage).',
    }),
    post: op({
      tags: ['Organizations'],
      summary: 'Create an organization',
      requestBody: json(
        obj({ name: str(), slug: str(), status: en(['active', 'pending', 'suspended']) }, [
          'name',
          'slug',
        ])
      ),
      responses: { '201': { description: 'Created' }, '403': ERR('Forbidden') },
    }),
  },
  '/api/v1/organizations/{id}': {
    get: op({
      tags: ['Organizations'],
      summary: 'Get an organization',
      parameters: [p('id', 'Organization ID')],
      responses: { '200': { description: 'Organization' }, '404': ERR('Not found') },
    }),
    patch: op({
      tags: ['Organizations'],
      summary: 'Update an organization',
      parameters: [p('id', 'Organization ID')],
      requestBody: json(obj({ name: str(), slug: str(), status: str() }), false),
    }),
  },
  '/api/v1/organizations/{id}/products': {
    get: op({
      tags: ['Organizations'],
      summary: 'List products assigned to an organization',
      parameters: [p('id', 'Organization ID')],
    }),
  },
  '/api/v1/organizations/{id}/subscriptions': {
    get: op({
      tags: ['Organizations'],
      summary: 'List subscriptions for an organization',
      parameters: [p('id', 'Organization ID')],
    }),
  },
  '/api/v1/organizations/{id}/widget-key/rotate': {
    post: op({
      tags: ['Organizations'],
      summary: 'Rotate the widget public key',
      description:
        'Issues a new public embed key for the organization; the previous key stops working.',
      parameters: [p('id', 'Organization ID')],
      responses: { '200': { description: 'New publicKey returned' } },
    }),
  },
  '/api/v1/organizations/settings': {
    get: op({
      tags: ['Organization settings'],
      summary: 'Get organization settings',
      description: 'Business profile, branding, and channel bindings for the caller’s org.',
    }),
    patch: op({
      tags: ['Organization settings'],
      summary: 'Update organization settings',
      description: 'Empty strings clear fields to null. Requires organization.update.',
      requestBody: json(
        obj(
          {
            businessName: str(),
            businessCategory: str(),
            website: str({ format: 'uri' }),
            contactEmail: str({ format: 'email' }),
            contactPhone: str(),
            address: str(),
            timezone: str(),
            defaultLanguage: str(),
            active: bool(),
            logoUrl: str({ format: 'uri' }),
            primaryColor: str(),
            secondaryColor: str(),
            whatsappPhoneNumberId: str({ description: 'Meta Cloud API phone_number_id' }),
            messengerPageId: str({ description: 'Facebook Page ID' }),
            instagramAccountId: str({ description: 'Instagram professional account ID' }),
            telegramBotToken: str({ description: 'BotFather bot token' }),
            inboundEmailAddress: str({ format: 'email' }),
          },
          []
        ),
        false
      ),
    }),
  },

  // ── Users & RBAC ──────────────────────────────────────────────────────────
  '/api/v1/users': {
    get: op({ tags: ['Users'], summary: 'List users in the organization' }),
    post: op({
      tags: ['Users'],
      summary: 'Create a user',
      requestBody: json(
        obj({ email: str({ format: 'email' }), name: str(), password: str({ minLength: 8 }) }, [
          'email',
          'name',
          'password',
        ])
      ),
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/users/{id}': {
    get: op({
      tags: ['Users'],
      summary: 'Get a user',
      parameters: [p('id', 'User ID')],
    }),
    patch: op({
      tags: ['Users'],
      summary: 'Update a user',
      parameters: [p('id', 'User ID')],
      requestBody: json(obj({ name: str(), status: str(), roleIds: { type: 'array', items: uuid() } }), false),
    }),
  },
  '/api/v1/roles': {
    get: op({ tags: ['RBAC'], summary: 'List roles' }),
  },
  '/api/v1/permissions': {
    get: op({ tags: ['RBAC'], summary: 'List permissions' }),
  },

  // ── Assistant configuration ───────────────────────────────────────────────
  '/api/v1/assist': {
    get: op({
      tags: ['Assistant'],
      summary: 'Get assistant configuration',
    }),
    patch: op({
      tags: ['Assistant'],
      summary: 'Update assistant configuration',
      requestBody: json(
        obj(
          {
            assistantName: str(),
            welcomeMessage: str(),
            businessDescription: str(),
            tone: str(),
            contactEmail: str({ format: 'email' }),
            contactPhone: str(),
            operatingHours: str(),
            escalationEnabled: bool(),
            leadCaptureEnabled: bool(),
            appointmentRequestsEnabled: bool(),
            publicChatEnabled: bool(),
            allowedOrigins: { type: 'array', items: str({ format: 'uri' }) },
            intakeFields: {
              type: 'array',
              items: obj({
                key: str(),
                label: str(),
                type: en(['text', 'select', 'checkbox']),
                required: bool(),
                options: { type: 'array', items: str() },
              }),
            },
            notificationEmail: str({ format: 'email' }),
            notifyOnLead: bool(),
            notifyOnHandoff: bool(),
            notifyOnAppointment: bool(),
          },
          []
        ),
        false
      ),
    }),
  },

  // ── Conversations & messages ──────────────────────────────────────────────
  '/api/v1/conversations': {
    get: op({
      tags: ['Conversations'],
      summary: 'List conversations',
      parameters: [
        ...pageParams,
        q('status', en(CONV_STATUSES)),
        q('channel', en(CHANNELS)),
      ],
    }),
    post: op({
      tags: ['Conversations'],
      summary: 'Create a staff-side conversation',
      requestBody: json(
        obj({ channel: en(['WEB', 'API']), title: str() }, [])
      ),
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/conversations/{id}': {
    get: op({
      tags: ['Conversations'],
      summary: 'Get a conversation',
      parameters: [p('id', 'Conversation ID')],
    }),
    patch: op({
      tags: ['Conversations'],
      summary: 'Update conversation status/title',
      parameters: [p('id', 'Conversation ID')],
      requestBody: json(obj({ status: en(CONV_STATUSES), title: str() }), false),
      responses: {
        '200': { description: 'Updated' },
        '400': ERR('Invalid status transition'),
      },
    }),
  },
  '/api/v1/conversations/{id}/messages': {
    get: op({
      tags: ['Conversations'],
      summary: 'List messages in a conversation',
      parameters: [p('id', 'Conversation ID'), ...pageParams],
    }),
    post: op({
      tags: ['Conversations'],
      summary: 'Post a user message and get the assistant reply',
      description: 'Runs the grounded AI pipeline. Idempotent on clientRequestId.',
      parameters: [p('id', 'Conversation ID')],
      requestBody: json(
        obj({ content: str(), clientRequestId: str({ minLength: 8, maxLength: 128 }) }, ['content'])
      ),
      responses: {
        '201': { description: 'User + assistant messages persisted' },
        '409': ERR('Conversation is not writable'),
      },
    }),
  },

  // ── Leads ──────────────────────────────────────────────────────────────────
  '/api/v1/leads': {
    get: op({
      tags: ['Leads'],
      summary: 'List leads',
      parameters: [
        ...pageParams,
        q('status', en(LEAD_STATUSES)),
        q('category', en(['GENERAL', 'SALES', 'SUPPORT', 'FEEDBACK', 'OTHER'])),
        q('source', str()),
        q('assignedTo', uuid()),
      ],
    }),
  },
  '/api/v1/leads/{id}': {
    get: op({
      tags: ['Leads'],
      summary: 'Get a lead',
      parameters: [p('id', 'Lead ID')],
    }),
    patch: op({
      tags: ['Leads'],
      summary: 'Update a lead',
      parameters: [p('id', 'Lead ID')],
      requestBody: json(
        obj(
          {
            name: str(),
            email: str({ format: 'email' }),
            phone: str(),
            enquiryCategory: en(['GENERAL', 'SALES', 'SUPPORT', 'FEEDBACK', 'OTHER']),
            summary: str(),
            status: en(LEAD_STATUSES),
            assignedTo: uuid(),
          },
          []
        ),
        false
      ),
    }),
  },
  '/api/v1/leads/{id}/notes': {
    post: op({
      tags: ['Leads'],
      summary: 'Add a note to a lead',
      parameters: [p('id', 'Lead ID')],
      requestBody: json(obj({ body: str({ maxLength: 2000 }) }, ['body'])),
      responses: { '201': { description: 'Created' } },
    }),
  },

  // ── Handoffs ───────────────────────────────────────────────────────────────
  '/api/v1/handoffs': {
    get: op({
      tags: ['Handoffs'],
      summary: 'List human handoffs',
      parameters: [
        ...pageParams,
        q('status', en(HANDOFF_STATUSES)),
        q('assignedTo', uuid()),
      ],
    }),
  },
  '/api/v1/handoffs/{id}': {
    get: op({
      tags: ['Handoffs'],
      summary: 'Get a handoff',
      parameters: [p('id', 'Handoff ID')],
    }),
  },
  '/api/v1/handoffs/{id}/claim': {
    post: op({
      tags: ['Handoffs'],
      summary: 'Claim a queued handoff',
      parameters: [p('id', 'Handoff ID')],
    }),
  },
  '/api/v1/handoffs/{id}/assign': {
    post: op({
      tags: ['Handoffs'],
      summary: 'Assign a handoff to a user',
      parameters: [p('id', 'Handoff ID')],
      requestBody: json(obj({ userId: { ...uuid(), nullable: true } }, ['userId'])),
    }),
  },
  '/api/v1/handoffs/{id}/resolve': {
    post: op({
      tags: ['Handoffs'],
      summary: 'Resolve a handoff',
      parameters: [p('id', 'Handoff ID')],
      requestBody: json(obj({ resolutionSummary: str({ maxLength: 1000 }) }), false),
    }),
  },
  '/api/v1/handoffs/{id}/cancel': {
    post: op({
      tags: ['Handoffs'],
      summary: 'Cancel a handoff',
      parameters: [p('id', 'Handoff ID')],
      requestBody: json(obj({ reason: str({ maxLength: 500 }) }), false),
    }),
  },
  '/api/v1/handoffs/{id}/notes': {
    post: op({
      tags: ['Handoffs'],
      summary: 'Add an internal note',
      parameters: [p('id', 'Handoff ID')],
      requestBody: json(obj({ body: str({ maxLength: 2000 }) }, ['body'])),
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/handoffs/{id}/replies': {
    post: op({
      tags: ['Handoffs'],
      summary: 'Reply to the visitor in a handoff conversation',
      parameters: [p('id', 'Handoff ID')],
      requestBody: json(
        obj({ content: str({ maxLength: 2000 }), clientRequestId: str() }, ['content'])
      ),
      responses: { '200': { description: 'Idempotent replay' }, '201': { description: 'Created' } },
    }),
  },

  // ── Appointments ──────────────────────────────────────────────────────────
  '/api/v1/appointments': {
    get: op({
      tags: ['Appointments'],
      summary: 'List appointment requests',
      parameters: [
        ...pageParams,
        q('status', en(APPT_STATUSES)),
        q('from', str({ format: 'date' })),
        q('to', str({ format: 'date' })),
        q('assignedTo', uuid()),
      ],
    }),
  },
  '/api/v1/appointments/{id}': {
    get: op({
      tags: ['Appointments'],
      summary: 'Get an appointment',
      parameters: [p('id', 'Appointment ID')],
    }),
    patch: op({
      tags: ['Appointments'],
      summary: 'Update an appointment',
      parameters: [p('id', 'Appointment ID')],
      requestBody: json(
        obj(
          {
            customerName: str(),
            email: str({ format: 'email' }),
            phone: str(),
            preferredDate: str({ format: 'date' }),
            preferredTime: str({ description: 'HH:mm 24h' }),
            status: en(APPT_STATUSES),
            assignedTo: uuid(),
          },
          []
        ),
        false
      ),
    }),
  },

  // ── Knowledge base ────────────────────────────────────────────────────────
  '/api/v1/knowledge': {
    get: op({
      tags: ['Knowledge'],
      summary: 'List knowledge items',
      parameters: [
        ...pageParams,
        q('status', en(['DRAFT', 'ACTIVE', 'ARCHIVED'])),
        q('category', str()),
      ],
    }),
    post: op({
      tags: ['Knowledge'],
      summary: 'Create a text knowledge item',
      requestBody: json(
        obj({ title: str(), content: str(), category: str(), status: str() }, ['title', 'content'])
      ),
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/knowledge/{id}': {
    get: op({
      tags: ['Knowledge'],
      summary: 'Get a knowledge item',
      parameters: [p('id', 'Knowledge item ID')],
    }),
    patch: op({
      tags: ['Knowledge'],
      summary: 'Update a knowledge item',
      parameters: [p('id', 'Knowledge item ID')],
      requestBody: json(
        obj({ title: str(), content: str(), category: str(), status: str() }),
        false
      ),
    }),
    delete: op({
      tags: ['Knowledge'],
      summary: 'Delete a knowledge item',
      parameters: [p('id', 'Knowledge item ID')],
      responses: { '204': { description: 'Deleted' } },
    }),
  },
  '/api/v1/knowledge/documents': {
    post: op({
      tags: ['Knowledge'],
      summary: 'Upload a knowledge document (PDF/text)',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: obj({ file: { type: 'string', format: 'binary' } }, ['file']),
          },
        },
      },
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/knowledge/{id}/process': {
    post: op({
      tags: ['Knowledge'],
      summary: 'Process a document into searchable chunks',
      parameters: [p('id', 'Knowledge item ID')],
    }),
  },
  '/api/v1/knowledge/retrieve': {
    post: op({
      tags: ['Knowledge'],
      summary: 'Retrieve relevant knowledge chunks',
      requestBody: json(obj({ query: str(), limit: int() }, ['query'])),
    }),
  },

  // ── AI ─────────────────────────────────────────────────────────────────────
  '/api/v1/ai/respond': {
    post: op({
      tags: ['AI'],
      summary: 'Direct grounded AI response',
      requestBody: json(obj({ message: str(), conversationId: uuid() }, ['message'])),
    }),
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  '/api/v1/reports/enquiries': {
    get: op({
      tags: ['Reports'],
      summary: 'Enquiry report (conversations, leads, handoffs, appointments)',
      parameters: [q('days', int({ default: 7, description: 'Lookback window in days' }))],
    }),
  },

  // ── Insight (WymInsight) ──────────────────────────────────────────────────
  '/api/v1/insight/datasets': {
    get: op({ tags: ['Insight'], summary: 'List datasets' }),
    post: op({
      tags: ['Insight'],
      summary: 'Upload a dataset (CSV/XLSX)',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: obj({ file: { type: 'string', format: 'binary' }, name: str() }, ['file']),
          },
        },
      },
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/insight/datasets/{id}': {
    get: op({
      tags: ['Insight'],
      summary: 'Get dataset detail and row preview',
      parameters: [p('id', 'Dataset ID')],
    }),
    delete: op({
      tags: ['Insight'],
      summary: 'Delete a dataset',
      parameters: [p('id', 'Dataset ID')],
      responses: { '204': { description: 'Deleted' } },
    }),
  },
  '/api/v1/insight/datasets/{id}/analyze': {
    post: op({
      tags: ['Insight'],
      summary: 'Run AI analysis on a dataset',
      parameters: [p('id', 'Dataset ID')],
      requestBody: json(obj({ prompt: str() }), false),
      responses: { '201': { description: 'Report created' } },
    }),
  },
  '/api/v1/insight/reports': {
    get: op({ tags: ['Insight'], summary: 'List insight reports' }),
  },
  '/api/v1/insight/reports/{id}': {
    get: op({
      tags: ['Insight'],
      summary: 'Get an insight report',
      parameters: [p('id', 'Report ID')],
    }),
  },
  '/api/v1/insight/reports/{id}/download': {
    get: op({
      tags: ['Insight'],
      summary: 'Download report export',
      parameters: [p('id', 'Report ID')],
    }),
  },

  // ── Flow (WymFlow) ─────────────────────────────────────────────────────────
  '/api/v1/flow/definitions': {
    get: op({ tags: ['Flow'], summary: 'List workflow definitions' }),
    post: op({
      tags: ['Flow'],
      summary: 'Create a workflow definition',
      requestBody: json(
        obj(
          {
            name: str(),
            description: str(),
            active: bool(),
            fields: {
              type: 'array',
              items: obj({
                key: str(),
                label: str(),
                type: en(['text', 'number', 'select', 'checkbox', 'date']),
                required: bool(),
                options: { type: 'array', items: str() },
              }),
            },
            steps: { type: 'array', items: obj({ name: str() }, ['name']) },
          },
          ['name', 'steps']
        )
      ),
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/flow/definitions/{id}': {
    get: op({
      tags: ['Flow'],
      summary: 'Get a workflow definition',
      parameters: [p('id', 'Definition ID')],
    }),
    patch: op({
      tags: ['Flow'],
      summary: 'Update a workflow definition',
      parameters: [p('id', 'Definition ID')],
      requestBody: json(obj({ name: str(), description: str(), active: bool() }), false),
    }),
  },
  '/api/v1/flow/instances': {
    get: op({
      tags: ['Flow'],
      summary: 'List workflow submissions',
      parameters: [...pageParams, q('status', en(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']))],
    }),
    post: op({
      tags: ['Flow'],
      summary: 'Submit a workflow instance',
      requestBody: json(
        obj({ definitionId: uuid(), title: str(), values: { type: 'object' } }, [
          'definitionId',
          'title',
        ])
      ),
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/flow/instances/{id}': {
    get: op({
      tags: ['Flow'],
      summary: 'Get a workflow instance',
      parameters: [p('id', 'Instance ID')],
    }),
  },
  '/api/v1/flow/instances/{id}/cancel': {
    post: op({
      tags: ['Flow'],
      summary: 'Cancel a workflow instance',
      parameters: [p('id', 'Instance ID')],
    }),
  },
  '/api/v1/flow/tasks': {
    get: op({
      tags: ['Flow'],
      summary: 'List approval tasks',
      parameters: [
        ...pageParams,
        q('status', en(TASK_STATUSES)),
        q('mine', bool(), 'Only tasks awaiting the caller'),
      ],
    }),
  },
  '/api/v1/flow/tasks/{id}/assign': {
    post: op({
      tags: ['Flow'],
      summary: 'Assign an approval task',
      parameters: [p('id', 'Task ID')],
      requestBody: json(obj({ userId: uuid() }, ['userId'])),
    }),
  },
  '/api/v1/flow/tasks/{id}/approve': {
    post: op({
      tags: ['Flow'],
      summary: 'Approve an approval task',
      parameters: [p('id', 'Task ID')],
      requestBody: json(obj({ comment: str() }), false),
    }),
  },
  '/api/v1/flow/tasks/{id}/reject': {
    post: op({
      tags: ['Flow'],
      summary: 'Reject an approval task',
      parameters: [p('id', 'Task ID')],
      requestBody: json(obj({ comment: str() }), false),
    }),
  },
  '/api/v1/flow/reminders/dispatch': {
    post: op({
      tags: ['Flow'],
      summary: 'Dispatch pending-task reminder notifications',
      description: 'Sends notification emails for tasks pending beyond the reminder threshold.',
    }),
  },

  // ── Admin (platform) ──────────────────────────────────────────────────────
  '/api/v1/admin/products': {
    get: op({
      tags: ['Admin'],
      summary: 'List products',
      description: 'Requires platform.manage.',
    }),
    post: op({
      tags: ['Admin'],
      summary: 'Create a product',
      requestBody: json(
        obj(
          { name: str(), code: str({ pattern: '^[A-Z0-9_]+$' }), description: str(), active: bool() },
          ['name', 'code']
        )
      ),
      responses: { '201': { description: 'Created' }, '409': ERR('Code exists') },
    }),
  },
  '/api/v1/admin/products/assign': {
    post: op({
      tags: ['Admin'],
      summary: 'Assign/revoke a product for an organization',
      description:
        'This is the runtime entitlement — subscriptions are billing records and do not grant access.',
      requestBody: json(
        obj(
          {
            organizationId: uuid(),
            productCode: en(['WYMASSIST', 'WYMINSIGHT', 'WYMFLOW']),
            status: en(['active', 'inactive']),
          },
          ['organizationId', 'productCode']
        )
      ),
      responses: { '201': { description: 'Assigned (idempotent)' } },
    }),
  },
  '/api/v1/admin/organizations/{id}/status': {
    post: op({
      tags: ['Admin'],
      summary: 'Set organization status',
      parameters: [p('id', 'Organization ID')],
      requestBody: json(obj({ status: en(['active', 'pending', 'suspended']) }, ['status'])),
    }),
  },
  '/api/v1/admin/subscriptions': {
    get: op({ tags: ['Admin'], summary: 'List subscriptions' }),
    post: op({
      tags: ['Admin'],
      summary: 'Create a subscription',
      requestBody: json(
        obj(
          {
            organizationId: uuid(),
            productCode: en(['WYMASSIST', 'WYMINSIGHT', 'WYMFLOW']),
            status: en(['trialing', 'active', 'suspended', 'cancelled', 'expired']),
            startAt: str({ format: 'date-time' }),
            endAt: str({ format: 'date-time', nullable: true }),
          },
          ['organizationId', 'productCode']
        )
      ),
      responses: { '201': { description: 'Created' } },
    }),
  },
  '/api/v1/admin/subscriptions/{id}': {
    patch: op({
      tags: ['Admin'],
      summary: 'Update a subscription',
      parameters: [p('id', 'Subscription ID')],
      requestBody: json(
        obj({ status: str(), endAt: str({ format: 'date-time', nullable: true }) }),
        false
      ),
    }),
  },
  '/api/v1/admin/usage': {
    get: op({
      tags: ['Admin'],
      summary: 'Platform usage overview',
      description: 'Org counts by status, usage totals, and per-organization volumes.',
    }),
  },
  '/api/v1/admin/audit-events': {
    get: op({
      tags: ['Admin'],
      summary: 'List audit events',
      parameters: [
        q('limit', int({ default: 50 })),
        q('organizationId', uuid()),
      ],
    }),
  },

  // ── Public assistant (unauthenticated, widget-facing) ─────────────────────
  '/api/v1/public/assist/config': {
    get: op({
      tags: ['Public assistant'],
      summary: 'Public widget configuration',
      parameters: [q('organizationSlug', str(), 'Org slug or public key', true)],
      auth: false,
    }),
  },
  '/api/v1/public/assist/sessions': {
    post: op({
      tags: ['Public assistant'],
      summary: 'Start a visitor chat session',
      auth: false,
      requestBody: json(obj({ organizationSlug: str() }, ['organizationSlug'])),
      responses: {
        '201': { description: 'Session created — returns session token' },
        '403': ERR('Origin not allowed / public chat disabled'),
      },
    }),
  },
  '/api/v1/public/assist/session': {
    get: op({
      tags: ['Public assistant'],
      summary: 'Current visitor session',
      auth: false,
      description: 'Requires the x-chat-session header from session creation.',
    }),
  },
  '/api/v1/public/assist/messages': {
    get: op({
      tags: ['Public assistant'],
      summary: 'Visitor message history',
      auth: false,
      parameters: [q('limit', int({ default: 100, maximum: 100 }))],
    }),
    post: op({
      tags: ['Public assistant'],
      summary: 'Send a visitor message, get assistant reply',
      auth: false,
      requestBody: json(
        obj({ content: str({ maxLength: 2000 }), clientRequestId: str() }, ['content'])
      ),
      responses: { '201': { description: 'Reply generated' }, '429': ERR('Rate limited') },
    }),
  },
  '/api/v1/public/assist/leads': {
    post: op({
      tags: ['Public assistant'],
      summary: 'Capture a lead from a visitor',
      auth: false,
      requestBody: json(
        obj(
          {
            name: str({ maxLength: 255 }),
            email: str({ format: 'email' }),
            phone: str({ minLength: 5, maxLength: 64 }),
            enquiryCategory: en(['GENERAL', 'SALES', 'SUPPORT', 'FEEDBACK', 'OTHER']),
            summary: str({ maxLength: 1000 }),
            consentToContact: bool(),
            customFields: { type: 'object' },
            clientRequestId: str(),
          },
          []
        )
      ),
      responses: { '201': { description: 'Lead captured' }, '429': ERR('Rate limited') },
    }),
  },
  '/api/v1/public/assist/handoff': {
    post: op({
      tags: ['Public assistant'],
      summary: 'Request a human handoff',
      auth: false,
      requestBody: json(obj({ reason: str({ maxLength: 500 }) }), false),
      responses: { '201': { description: 'Handoff queued' }, '429': ERR('Rate limited') },
    }),
    get: op({
      tags: ['Public assistant'],
      summary: 'Handoff status for the visitor session',
      auth: false,
    }),
  },
  '/api/v1/public/assist/appointments': {
    post: op({
      tags: ['Public assistant'],
      summary: 'Request an appointment',
      auth: false,
      requestBody: json(
        obj(
          {
            customerName: str({ maxLength: 255 }),
            email: str({ format: 'email' }),
            phone: str({ minLength: 5, maxLength: 64 }),
            preferredDate: str({ format: 'date' }),
            preferredTime: str({ description: 'HH:mm 24h' }),
            reason: str({ maxLength: 1000 }),
            clientRequestId: str(),
          },
          ['customerName', 'preferredDate', 'preferredTime']
        )
      ),
      responses: { '201': { description: 'Request recorded' }, '429': ERR('Rate limited') },
    }),
  },

  // ── Channel webhooks (inbound, unauthenticated) ────────────────────────────
  '/api/v1/webhooks/whatsapp': {
    get: op({
      tags: ['Webhooks'],
      summary: 'Meta webhook verification (WhatsApp)',
      auth: false,
      parameters: [
        q('hub.mode', str()),
        q('hub.verify_token', str()),
        q('hub.challenge', str()),
      ],
    }),
    post: op({
      tags: ['Webhooks'],
      summary: 'Inbound WhatsApp message (Meta Cloud API)',
      auth: false,
      requestBody: json({ type: 'object' }, false),
      responses: { '200': { description: '{ accepted: n } — per-message errors are logged, not fatal' } },
    }),
  },
  '/api/v1/webhooks/messenger': {
    get: op({
      tags: ['Webhooks'],
      summary: 'Meta webhook verification (Messenger)',
      auth: false,
      parameters: [
        q('hub.mode', str()),
        q('hub.verify_token', str()),
        q('hub.challenge', str()),
      ],
    }),
    post: op({
      tags: ['Webhooks'],
      summary: 'Inbound Messenger message',
      auth: false,
      requestBody: json({ type: 'object' }, false),
      responses: { '200': { description: '{ accepted: n }' } },
    }),
  },
  '/api/v1/webhooks/instagram': {
    get: op({
      tags: ['Webhooks'],
      summary: 'Meta webhook verification (Instagram)',
      auth: false,
      parameters: [
        q('hub.mode', str()),
        q('hub.verify_token', str()),
        q('hub.challenge', str()),
      ],
    }),
    post: op({
      tags: ['Webhooks'],
      summary: 'Inbound Instagram DM',
      auth: false,
      requestBody: json({ type: 'object' }, false),
      responses: { '200': { description: '{ accepted: n }' } },
    }),
  },
  '/api/v1/webhooks/telegram/{botToken}': {
    post: op({
      tags: ['Webhooks'],
      summary: 'Inbound Telegram update',
      auth: false,
      description:
        'The org’s BotFather bot token in the path identifies the organization. Requires the x-telegram-bot-api-secret-token header when TELEGRAM_WEBHOOK_SECRET is set.',
      parameters: [p('botToken', 'Organization bot token', str())],
      requestBody: json({ type: 'object' }, false),
      responses: {
        '200': { description: '{ accepted: n }' },
        '403': ERR('Bad webhook secret'),
        '404': ERR('No organization bound to this bot'),
      },
    }),
  },
  '/api/v1/webhooks/email': {
    post: op({
      tags: ['Webhooks'],
      summary: 'Inbound email (provider-agnostic)',
      auth: false,
      description:
        'SendGrid Inbound Parse / Mailgun / SES normalize to this JSON. Requires x-webhook-secret header or ?secret= when EMAIL_INBOUND_SECRET is set.',
      requestBody: json(
        obj(
          {
            from: str({ description: '"Name <a@b>" or bare address' }),
            to: str({ description: 'Must match the org’s inboundEmailAddress' }),
            subject: str(),
            text: str(),
            messageId: str({ description: 'Provider Message-Id for idempotency/threading' }),
          },
          ['from', 'to', 'text']
        )
      ),
      responses: {
        '200': { description: '{ accepted: 1, conversationId, replied }' },
        '400': ERR('Missing/invalid fields'),
        '401': ERR('Bad webhook secret'),
        '404': ERR('No organization bound to this address'),
      },
    }),
  },

  // ── Widget bundle ─────────────────────────────────────────────────────────
  '/widget/wymassist.js': {
    get: op({
      tags: ['Widget'],
      summary: 'Embeddable chat widget bundle',
      description:
        'Standalone IIFE — embed with <script src="<api>/widget/wymassist.js" data-org="<slug-or-key>" data-api="<api>" async>.',
      auth: false,
      responses: { '200': { description: 'JavaScript bundle' } },
    }),
  },
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'WymNet AI API',
    version: '0.1.0',
    description:
      'Organizational AI assistants grounded in approved knowledge, with lead capture, human handoff, and multi-channel delivery (website widget, WhatsApp, Messenger, Instagram, Telegram, email).',
  },
  servers: [{ url: '/' }],
  components: {
    schemas: {
      Error: errorSchema,
      TokenPair: tokenPair,
    },
  },
  tags: [
    { name: 'System' },
    { name: 'Auth' },
    { name: 'Organizations' },
    { name: 'Organization settings' },
    { name: 'Users' },
    { name: 'RBAC' },
    { name: 'Assistant' },
    { name: 'Conversations' },
    { name: 'Leads' },
    { name: 'Handoffs' },
    { name: 'Appointments' },
    { name: 'Knowledge' },
    { name: 'AI' },
    { name: 'Reports' },
    { name: 'Insight' },
    { name: 'Flow' },
    { name: 'Admin' },
    { name: 'Public assistant' },
    { name: 'Webhooks' },
    { name: 'Widget' },
  ],
  paths,
};
