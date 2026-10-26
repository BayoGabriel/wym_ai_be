import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { validate } from '../../middleware/validate';
import { createOrganizationSchema, updateOrganizationSchema } from './schemas';
import {
  createOrganization,
  getOrganization,
  listOrganizationProducts,
  listOrganizations,
  updateOrganization,
} from './controller';

const router = Router();

router.get('/', authenticate, listOrganizations);
router.get('/:id', authenticate, getOrganization);
router.get('/:id/products', authenticate, listOrganizationProducts);
router.post('/', authenticate, validate(createOrganizationSchema), createOrganization);
router.patch('/:id', authenticate, validate(updateOrganizationSchema), updateOrganization);

export default router;
