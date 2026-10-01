import * as notificationService from '../services/notifications.js';

// @ENDPOINT GET http://localhost:4000/api/notifications
export const listNotifications = async (req, res, next) => {
  try {
    res.json(await notificationService.listNotifications(req.user.id, req.validatedQuery));
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/notifications/read-all
export const markAllRead = async (req, res, next) => {
  try {
    const updated = await notificationService.markAllRead(req.user.id);
    res.json({ updated });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/notifications/:id/read
export const markRead = async (req, res, next) => {
  try {
    await notificationService.markRead(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};
