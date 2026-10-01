import express from 'express';
import { z } from 'zod';

// controllers
import { listNotifications, markAllRead, markRead } from '../controllers/notifications.js';
// middleware
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();
router.use(authenticate);

const listQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// @ENDPOINT http://localhost:4000/api/notifications
router.get('/', validate({ query: listQuerySchema }), listNotifications);
// @ENDPOINT http://localhost:4000/api/notifications/read-all
router.post('/read-all', markAllRead);
// @ENDPOINT http://localhost:4000/api/notifications/:id/read
router.post('/:id/read', markRead);

export default router;
