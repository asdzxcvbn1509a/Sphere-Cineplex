import api from './client.js';

/** รายการแจ้งเตือน พร้อมจำนวนที่ยังไม่ได้อ่าน */
export const listNotifications = async ({ unreadOnly, limit } = {}) => {
  return await api.get('/notifications', {
    params: {
      ...(unreadOnly && { unreadOnly }),
      ...(limit && { limit }),
    },
  });
};

/** ใช้กับ badge บน header — ขอมาแค่รายการเดียวพอ เพราะสนใจแค่ unreadCount */
export const getUnreadCount = async () => {
  return await api.get('/notifications', { params: { unreadOnly: true, limit: 1 } });
};

export const markNotificationRead = async (notificationId) => {
  return await api.post(`/notifications/${notificationId}/read`);
};

export const markAllNotificationsRead = async () => {
  return await api.post('/notifications/read-all');
};
