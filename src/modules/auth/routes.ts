import { NextFunction, Request, Response, Router } from 'express';
import { validate } from '../../middleware/validate';
import { loginSchema, refreshSchema, registerSchema } from './schemas';
import { db } from '../../database/client';
import { organizations, users, userRoles, roles } from '../../database/schema/core';
import { eq } from 'drizzle-orm';
import {
  issueTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyAccessToken,
  verifyPassword,
} from './service';
import { authenticate } from './middleware';
import { newPublicKey } from '../../lib/keys';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.post('/register', validate(registerSchema), handle(async (req, res) => {
  const { email, password, name, organizationName, organizationSlug } = req.body;
  // Prevent duplicate email
  const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUser.length)
    return res
      .status(409)
      .json({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });

  // Organization slug
  const slugBase = (organizationSlug || organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!slugBase) {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Organization name must contain letters or numbers' } });
  }
  const slug = slugBase;
  const orgExists = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (orgExists.length)
    return res
      .status(409)
      .json({ error: { code: 'ORG_EXISTS', message: 'Organization slug already exists' } });

  const { hashPassword, issueTokens } = await import('./service');
  const passwordHash = await hashPassword(password);

  // Org + user + role must be created atomically — a partial signup must not
  // leave an organization with no members.
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, 'Client Administrator'))
    .limit(1);

  const { org, user } = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: organizationName, slug, status: 'active', publicKey: newPublicKey() })
      .returning();
    const [user] = await tx
      .insert(users)
      .values({ email, name, passwordHash, status: 'active', organizationId: org.id })
      .returning();
    if (role) {
      await tx
        .insert(userRoles)
        .values({ userId: user.id, roleId: role.id, organizationId: org.id });
    }
    return { org, user };
  });

  const tokens = await issueTokens({ id: user.id, organizationId: org.id, status: 'active' });
  return res.status(201).json({
    organization: { id: org.id, name: org.name, slug: org.slug },
    user: { id: user.id, email: user.email, name: user.name },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
}));

router.post('/login', validate(loginSchema), handle(async (req, res) => {
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
}));

router.post('/refresh', validate(refreshSchema), handle(async (req, res) => {
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
    const payload = verifyAccessToken(accessToken, { ignoreExpiration: true });
    const tokens = await rotateRefreshToken(payload.sub, refreshToken);
    return res.json(tokens);
  } catch {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access token' } });
  }
}));

router.post('/logout', validate(refreshSchema), handle(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Missing access token' } });
  const accessToken = auth.substring('Bearer '.length);
  try {
    const payload = verifyAccessToken(accessToken, { ignoreExpiration: true });
    await revokeRefreshToken(payload.sub, refreshToken);
    return res.status(204).send();
  } catch {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access token' } });
  }
}));

router.get('/me', authenticate, handle(async (req, res) => {
  const auth = req.auth;
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
}));

export default router;
