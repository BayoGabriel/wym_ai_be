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
};
