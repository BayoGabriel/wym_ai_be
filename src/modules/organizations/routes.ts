import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { validate } from '../../middleware/validate';
import { createOrganizationSchema, updateOrganizationSchema } from './schemas';
import {
  createOrganization,
  getOrganization,
  listOrganizationProducts,
  listOrganizationAuditEvents,
  listOrganizationSubscriptions,
  listOrganizations,
  rotateWidgetKey,
  updateOrganization,
} from './controller';

const router = Router();

router.get('/', authenticate, listOrganizations);
router.get('/:id', authenticate, getOrganization);
router.get('/:id/products', authenticate, listOrganizationProducts);
router.get('/:id/subscriptions', authenticate, listOrganizationSubscriptions);
router.get('/:id/audit-events', authenticate, listOrganizationAuditEvents);
router.post('/', authenticate, validate(createOrganizationSchema), createOrganization);
router.post('/:id/widget-key/rotate', authenticate, rotateWidgetKey);
router.patch('/:id', authenticate, validate(updateOrganizationSchema), updateOrganization);

export default router;
