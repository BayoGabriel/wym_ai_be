import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { env } from '../../config/env';
import { db } from '../../database/client';
import { passwordResetTokens, refreshTokens, users } from '../../database/schema/core';
import { eq, and, gt, isNull } from 'drizzle-orm';

export type Tokens = { accessToken: string; refreshToken: string };

function signAccessToken(payload: object): string {
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
  };
  return jwt.sign(payload as object, env.JWT_ACCESS_SECRET, options);
}

function signRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(48).toString('hex');
  const expires = new Date(Date.now() + parseTtlMs(env.REFRESH_TOKEN_TTL));
  // store sha256 to keep bcrypt cost for passwords only
  const hash = createSha256(token);
  return { token, hash, expiresAt: expires };
}

function parseTtlMs(ttl: string): number {
  // very small parser for '15m', '30d', '1h'
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid TTL format: ${ttl}`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  switch (unit) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    default:
      throw new Error('Unsupported TTL unit');
  }
}

function createSha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(env.BCRYPT_SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function issueTokens(user: {
  id: string;
  organizationId: string | null;
  status: string;
}) {
  const accessToken = signAccessToken({ sub: user.id, org: user.organizationId });
  const { token, hash, expiresAt } = signRefreshToken();
  await db.insert(refreshTokens).values({ userId: user.id, tokenHash: hash, expiresAt });
  return { accessToken, refreshToken: token } satisfies Tokens;
}

export async function rotateRefreshToken(userId: string, oldToken: string) {
  const oldHash = createSha256(oldToken);
  const existing = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.tokenHash, oldHash),
        gt(refreshTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  if (existing.length === 0) throw new Error('Invalid refresh token');
  // Revoke by deleting or marking revoked; keep simple: delete
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.tokenHash, oldHash)));

  const { token, hash, expiresAt } = signRefreshToken();
  await db.insert(refreshTokens).values({ userId, tokenHash: hash, expiresAt });
  const accessToken = signAccessToken({ sub: userId });
  return { accessToken, refreshToken: token } satisfies Tokens;
}

export async function revokeRefreshToken(userId: string, token: string) {
  const oldHash = createSha256(token);
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.tokenHash, oldHash)));
}

// Password reset tokens are random 48-byte hex strings; only the sha256 hash
// is persisted so a database leak cannot be used to reset passwords.
export async function createPasswordResetToken(
  userId: string,
  ttlMinutes = env.PASSWORD_RESET_TOKEN_TTL_MINUTES
): Promise<string> {
  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await db
    .insert(passwordResetTokens)
    .values({ userId, tokenHash: createSha256(token), expiresAt });
  return token;
}

// Consumes a reset token: updates the password, marks the token used, and
// revokes every refresh token so existing sessions cannot persist with the
// old credentials.
export async function resetPasswordWithToken(token: string, password: string): Promise<void> {
  const tokenHash = createSha256(token);
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!row) throw new Error('Invalid or expired reset token');

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
    await tx.delete(refreshTokens).where(eq(refreshTokens.userId, row.userId));
  });
}

export function verifyAccessToken(
  token: string,
  options?: { ignoreExpiration?: boolean }
): { sub: string; org?: string | null; imp?: string } {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    ignoreExpiration: options?.ignoreExpiration ?? false,
  }) as { sub: string; org?: string | null; imp?: string };
}

/** Issues a short-lived view-as token for platform admins. The `imp` claim
 *  carries the real admin's user id so every impersonated action is auditable. */
export function issueImpersonationToken(params: { userId: string; organizationId: string; adminUserId: string }) {
  const options: SignOptions = { algorithm: 'HS256', expiresIn: '30m' };
  return jwt.sign(
    { sub: params.userId, org: params.organizationId, imp: params.adminUserId },
    env.JWT_ACCESS_SECRET,
    options
  );
}
