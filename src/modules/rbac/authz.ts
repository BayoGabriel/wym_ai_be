import { PermissionValue } from './permissions';
import { AuthContext } from '../../types/auth';

export function hasPermission(ctx: AuthContext, permission: PermissionValue) {
  return ctx.permissions.includes(permission);
}

export function requirePermission(ctx: AuthContext, permission: PermissionValue) {
  if (!ctx.permissions.includes(permission)) {
    const err: Error & { status?: number; code?: string } = new Error('Forbidden');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

export function requirePlatform(ctx: AuthContext) {
  if (!ctx.platformAccess) {
    const err: Error & { status?: number; code?: string } = new Error('Forbidden: platform access required');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

export function requireOrgScope(ctx: AuthContext, organizationId: string) {
  if (!ctx.organizationId || ctx.organizationId !== organizationId) {
    const err: Error & { status?: number; code?: string } = new Error('Forbidden: organization scope mismatch');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}
