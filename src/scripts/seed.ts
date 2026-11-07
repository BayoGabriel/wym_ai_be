import 'dotenv/config';
import { db } from '../database/client';
import {
  appointments,
  assistantConfigurations,
  conversations,
  handoffs,
  knowledgeItems,
  leads,
  messages,
  organizations,
  organizationProducts,
  roles,
  permissions,
  products,
  rolePermissions,
  users,
  userRoles,
} from '../database/schema/core';

async function ensureEntitlement(organizationId: string, productCode: string) {
  const [p] = await db.select().from(products).where(eq(products.code, productCode)).limit(1);
  if (!p) return;
  const [existing] = await db
    .select()
    .from(organizationProducts)
    .where(and(eq(organizationProducts.organizationId, organizationId), eq(organizationProducts.productId, p.id)))
    .limit(1);
  if (!existing) {
    await db.insert(organizationProducts).values({ organizationId, productId: p.id, status: 'active' });
  }
}
import { and, eq } from 'drizzle-orm';
import { PERMISSIONS } from '../modules/rbac/permissions';
import { hashPassword } from '../modules/auth/service';

async function ensurePermission(name: string) {
  const existing = await db.select().from(permissions).where(eq(permissions.name, name)).limit(1);
  if (existing.length === 0) {
    await db.insert(permissions).values({ name });
  }
}

async function ensureRole(name: string, scope: 'platform' | 'organization') {
  const existing = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (existing.length === 0) {
    await db.insert(roles).values({ name, scope });
  }
}

async function idForRole(name: string) {
  const [r] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  return r?.id as string;
}

async function idForPermission(name: string) {
  const [p] = await db.select().from(permissions).where(eq(permissions.name, name)).limit(1);
  return p?.id as string;
}

async function grant(roleName: string, permissionName: string) {
  const roleId = await idForRole(roleName);
  const permissionId = await idForPermission(permissionName);
  if (!roleId || !permissionId) return;
  const existing = await db
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(rolePermissions).values({ roleId, permissionId });
  }
}

async function ensureProduct(code: string, name: string, description?: string) {
  const existing = await db.select().from(products).where(eq(products.code, code)).limit(1);
  if (existing.length === 0) {
    await db.insert(products).values({ code, name, description });
  }
}

async function main() {
  // Permissions
  for (const key of Object.keys(PERMISSIONS)) {
    await ensurePermission(PERMISSIONS[key as keyof typeof PERMISSIONS]);
  }

  // Roles
  await ensureRole('WymNet Super Administrator', 'platform');
  await ensureRole('WymNet Administrator', 'platform');
  await ensureRole('Client Administrator', 'organization');
  await ensureRole('Client Staff', 'organization');
  await ensureRole('Agent', 'organization');
  await ensureRole('Viewer', 'organization');

  // Products
  await ensureProduct('WYMASSIST', 'WymAssist AI', 'Customer-facing assistant product');
  await ensureProduct('WYMINSIGHT', 'WymInsight AI', 'Insights and analytics product');
  await ensureProduct('WYMFLOW', 'WymFlow AI', 'Workflow and automation product');

  // Role-permission seeds (sample, can be expanded)
  const platformWide = [
    'platform.manage',
    'organization.read',
    'organization.create',
    'organization.update',
    'user.read',
    'user.create',
    'user.update',
    'role.read',
    'permission.read',
    'conversation.read',
    'conversation.create',
    'conversation.update',
    'conversation.message.create',
    'handoff.read',
    'handoff.write',
    'handoff.assign',
    'lead.read',
    'lead.write',
    'knowledge.read',
    'knowledge.write',
    'appointment.read',
    'appointment.write',
    'report.read',
    'insight.read',
    'insight.write',
    'flow.read',
    'flow.write',
    'flow.admin',
    'subscription.read',
    'subscription.write',
  ];
  for (const perm of platformWide) await grant('WymNet Super Administrator', perm);

  const platformAdmin = [
    'organization.read',
    'organization.create',
    'organization.update',
    'user.read',
    'user.create',
    'user.update',
    'role.read',
    'permission.read',
    'conversation.read',
    'conversation.create',
    'conversation.update',
    'conversation.message.create',
    'handoff.read',
    'handoff.write',
    'handoff.assign',
    'appointment.read',
    'appointment.write',
    'report.read',
    'insight.read',
    'insight.write',
    'flow.read',
    'flow.write',
    'flow.admin',
    'subscription.read',
    'subscription.write',
  ];
  for (const perm of platformAdmin) await grant('WymNet Administrator', perm);

  const clientAdmin = [
    'organization.read',
    'organization.update',
    'user.read',
    'user.create',
    'user.update',
    'conversation.read',
    'conversation.create',
    'conversation.update',
    'conversation.message.create',
    'lead.read',
    'lead.write',
    'handoff.read',
    'handoff.write',
    'handoff.assign',
    'knowledge.read',
    'knowledge.write',
    'appointment.read',
    'appointment.write',
    'report.read',
    'insight.read',
    'insight.write',
    'flow.read',
    'flow.write',
    'flow.admin',
    'subscription.read',
  ];
  for (const perm of clientAdmin) await grant('Client Administrator', perm);

  const clientStaff = [
    'organization.read',
    'conversation.read',
    'conversation.create',
    'conversation.message.create',
    'lead.read',
    'lead.write',
    'handoff.read',
    'handoff.write',
    'knowledge.read',
    'appointment.read',
    'appointment.write',
    'insight.read',
    'flow.read',
    'flow.write',
  ];
  for (const perm of clientStaff) await grant('Client Staff', perm);

  // Agent — inbox-focused: can work conversations, handoffs, leads,
  // appointments and knowledge but not org/team settings.
  const agent = [
    'organization.read',
    'conversation.read',
    'conversation.update',
    'conversation.message.create',
    'lead.read',
    'lead.write',
    'handoff.read',
    'handoff.write',
    'handoff.assign',
    'knowledge.read',
    'knowledge.write',
    'appointment.read',
    'appointment.write',
    'report.read',
  ];
  for (const perm of agent) await grant('Agent', perm);

  // Viewer — read-only reporting seat.
  const viewer = [
    'organization.read',
    'conversation.read',
    'lead.read',
    'handoff.read',
    'knowledge.read',
    'appointment.read',
    'report.read',
  ];
  for (const perm of viewer) await grant('Viewer', perm);

  // Platform super administrator (organizationId null → platform access).
  // In production the credentials must be supplied explicitly — the built-in
  // defaults exist for local development only.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'info@wymnet.org';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === 'production' && !adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD must be set when seeding a production database');
  }
  const resolvedAdminPassword = adminPassword ?? 'Wymnet@1995';
  let [admin] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  if (!admin) {
    const passwordHash = await hashPassword(resolvedAdminPassword);
    [admin] = await db
      .insert(users)
      .values({
        email: adminEmail,
        name: 'WymNet Super Admin',
        passwordHash,
        status: 'active',
        organizationId: null,
      })
      .returning();
  }
  const superRoleId = await idForRole('WymNet Super Administrator');
  const [assigned] = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, admin.id), eq(userRoles.roleId, superRoleId)))
    .limit(1);
  if (!assigned) {
    await db.insert(userRoles).values({ userId: admin.id, roleId: superRoleId });
  }

  // Optional demo client — `SEED_DEMO=true npm run seed` populates a
  // presentable workspace (conversations, leads, handoffs, appointments,
  // knowledge) so the dashboard shows real data on first sign-in.
  if (process.env.SEED_DEMO === 'true') {
    const [demoOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, 'acme-wellness'))
      .limit(1);
    if (!demoOrg) {
      const [org] = await db
        .insert(organizations)
        .values({ name: 'Acme Wellness', slug: 'acme-wellness', status: 'active' })
        .returning();
      await ensureEntitlement(org.id, 'WYMASSIST');
      const demoPass = await hashPassword('Demo1234!');
      const [demoAdmin] = await db
        .insert(users)
        .values({
          email: 'admin@acmewellness.demo',
          name: 'Acme Admin',
          passwordHash: demoPass,
          status: 'active',
          organizationId: org.id,
        })
        .returning();
      const clientAdminId = await idForRole('Client Administrator');
      await db.insert(userRoles).values({
        userId: demoAdmin.id,
        roleId: clientAdminId,
        organizationId: org.id,
      });
      const [agentUser] = await db
        .insert(users)
        .values({
          email: 'agent@acmewellness.demo',
          name: 'Acme Agent',
          passwordHash: demoPass,
          status: 'active',
          organizationId: org.id,
        })
        .returning();
      const agentRoleId = await idForRole('Agent');
      await db.insert(userRoles).values({
        userId: agentUser.id,
        roleId: agentRoleId,
        organizationId: org.id,
      });
      await db.insert(assistantConfigurations).values({
        organizationId: org.id,
        assistantName: 'Sage',
        welcomeMessage: 'Hi! I can help you book a session or answer questions about our treatments.',
        publicChatEnabled: true,
        leadCaptureEnabled: true,
        escalationEnabled: true,
        appointmentRequestsEnabled: true,
      });
      const faqs = [
        { title: 'What are your opening hours?', content: 'We are open Monday–Saturday, 9:00–18:00. Sunday bookings are by request only.' },
        { title: 'How much does a massage cost?', content: 'A 60-minute massage is $85, 90-minute is $120. Packages of five sessions save 15%.' },
        { title: 'Can I cancel or reschedule?', content: 'Yes — free cancellation up to 24 hours before your appointment. Later changes may incur a fee.' },
      ];
      for (const f of faqs) {
        await db.insert(knowledgeItems).values({
          organizationId: org.id, title: f.title, content: f.content,
          category: 'FAQ', status: 'ACTIVE', sourceType: 'TEXT',
          createdBy: demoAdmin.id, updatedBy: demoAdmin.id,
        });
      }
      const now = Date.now();
      for (let i = 0; i < 12; i++) {
        const created = new Date(now - (i * 41 + 7) * 3_600_000);
        const [conv] = await db.insert(conversations).values({
          organizationId: org.id, status: i % 5 === 0 ? 'CLOSED' : 'ACTIVE',
          channel: ['WEB', 'WHATSAPP', 'MESSENGER'][i % 3] as 'WEB' | 'WHATSAPP' | 'MESSENGER',
          title: `Visitor chat #${12 - i}`, createdAt: created, updatedAt: created,
        }).returning();
        await db.insert(messages).values([
          { organizationId: org.id, conversationId: conv.id, role: 'USER', content: 'Hi, do you have availability this week?', createdAt: created },
          { organizationId: org.id, conversationId: conv.id, role: 'ASSISTANT', content: 'Yes! We have openings Thursday and Friday afternoon. Would you like to book?', grounded: true, createdAt: new Date(created.getTime() + 90_000) },
        ]);
        if (i % 4 === 0) {
          await db.insert(leads).values({
            organizationId: org.id, conversationId: conv.id, name: `Demo Lead ${i}`,
            email: `lead${i}@demo.test`, phone: `+1555000${100 + i}`,
            enquiryCategory: 'PRICING', status: ['NEW', 'CONTACTED', 'QUALIFIED'][i % 3] as 'NEW' | 'CONTACTED' | 'QUALIFIED',
            source: 'CHAT', consentToContact: true, createdAt: created,
          });
        }
      }
      await db.insert(handoffs).values({
        organizationId: org.id,
        conversationId: (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, org.id)).limit(1))[0].id,
        status: 'QUEUED', requestedBy: 'VISITOR', reason: 'Wants to discuss a health condition before booking',
      });
      await db.insert(appointments).values([
        { organizationId: org.id, customerName: 'Demo Customer', email: 'cust@demo.test', preferredDate: '2026-11-12', preferredTime: '14:00', reason: 'Massage', status: 'REQUESTED', source: 'CHAT' },
        { organizationId: org.id, customerName: 'Returning Guest', phone: '+15550123', preferredDate: '2026-11-14', preferredTime: '10:30', reason: 'Consult', status: 'CONFIRMED', source: 'CHAT' },
      ]);
      // eslint-disable-next-line no-console
      console.log('Demo client seeded: acme-wellness (admin@acmewellness.demo / Demo1234!)');
    }
  }

  // eslint-disable-next-line no-console
  console.log('Seed completed');
  process.exit(0);
}

main().catch((err) => {
   
  console.error(err);
  process.exit(1);
});
