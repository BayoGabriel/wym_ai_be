import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { loginSchema, refreshSchema, registerSchema } from './schemas';
import { db } from '../../database/client';
import { organizations, users, userRoles, roles } from '../../database/schema/core';
import { and, eq } from 'drizzle-orm';
import {
  issueTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyAccessToken,
  verifyPassword,
} from './service';
import { authenticate } from './middleware';

const router = Router();

router.post('/register', validate(registerSchema), async (req, res) => {
  const { email, password, name, organizationName, organizationSlug } = req.body as any;
  // Prevent duplicate email
  const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length)
    return res
      .status(409)
      .json({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });

  // Organization slug
  const slug = (
    organizationSlug || organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  ).replace(/^-+|-+$/g, '');
  const orgExists = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (orgExists.length)
    return res
      .status(409)
      .json({ error: { code: 'ORG_EXISTS', message: 'Organization slug already exists' } });

  // Create org + user
  const [org] = await db
    .insert(organizations)
    .values({ name: organizationName, slug, status: 'active' })
    .returning();
  const { hashPassword, issueTokens } = await import('./service');
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, name, passwordHash, status: 'active', organizationId: org.id })
    .returning();

  // Assign default org admin role if present
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, 'Client Administrator'))
    .limit(1);
  if (role) {
    await db
      .insert(userRoles)
      .values({ userId: user.id, roleId: role.id, organizationId: org.id })
      .onConflictDoNothing?.();
  }

  const tokens = await issueTokens({ id: user.id, organizationId: org.id, status: 'active' });
  return res.status(201).json({
    organization: { id: org.id, name: org.name, slug: org.slug },
    user: { id: user.id, email: user.email, name: user.name },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user)
    return res
      .status(401)
      .json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  if (user.status !== 'active')
    return res
      .status(403)
      .json({ error: { code: 'USER_SUSPENDED', message: 'User is not active' } });
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok)
    return res
      .status(401)
      .json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  const tokens = await issueTokens({
    id: user.id,
    organizationId: user.organizationId ?? null,
    status: user.status,
  });
  return res.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

router.post('/refresh', validate(refreshSchema), async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  // We need user context to rotate; require clients to send existing access token or include user id in token
  // For simplicity, decode if client also sends current access token
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Missing access token' } });
  const accessToken = auth.substring('Bearer '.length);
  try {
    // The access token only binds the refresh to a user; an expired (but
    // validly signed) access token must not prevent refresh — that is the
    // whole point of the refresh flow.
    const payload = verifyAccessToken(accessToken, { ignoreExpiration: true }) as any;
    const tokens = await rotateRefreshToken(payload.sub, refreshToken);
    return res.json(tokens);
  } catch {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access token' } });
  }
});

router.post('/logout', validate(refreshSchema), async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Missing access token' } });
  const accessToken = auth.substring('Bearer '.length);
  try {
    const payload = verifyAccessToken(accessToken, { ignoreExpiration: true }) as any;
    await revokeRefreshToken(payload.sub, refreshToken);
    return res.status(204).send();
  } catch {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access token' } });
  }
});

router.get('/me', authenticate, async (req, res) => {
  const auth = (req as any).auth;
  const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user)
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unknown user' } });
  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    organizationId: auth.organizationId,
    roles: auth.roles,
    permissions: auth.permissions,
    platformAccess: auth.platformAccess,
  });
});

export default router;
