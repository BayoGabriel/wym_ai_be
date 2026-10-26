import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { validate } from '../../middleware/validate';
import { createUserSchema, updateUserSchema } from './schemas';
import { createUser, getUser, listUsers, updateUser } from './controller';

const router = Router();

router.get('/', authenticate, listUsers);
router.get('/:id', authenticate, getUser);
router.post('/', authenticate, validate(createUserSchema), createUser);
router.patch('/:id', authenticate, validate(updateUserSchema), updateUser);

export default router;
