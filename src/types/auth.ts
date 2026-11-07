export type AuthContext = {
  userId: string;
  organizationId: string | null;
  roles: {
    id: string;
    name: string;
    scope: 'platform' | 'organization';
    organizationId?: string | null;
  }[];
  permissions: string[];
  platformAccess: boolean;
  /** Set when the caller is a platform admin viewing as another user. */
  impersonatedBy?: string;
};
