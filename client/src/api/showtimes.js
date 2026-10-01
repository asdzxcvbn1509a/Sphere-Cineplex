import api from './client.js';

/** รอบฉาย — กรองตามเรื่อง/โรง/วัน (วันเป็นรูปแบบ YYYY-MM-DD ตามเวลาไทย) */
export const listShowtimes = async ({ movieId, theatreId, date } = {}) => {
  return await api.get('/showtimes', {
    params: {
      ...(movieId && { movieId }),
      ...(theatreId && { theatreId }),
      ...(date && { date }),
    },
  });
};

export const getShowtime = async (showtimeId) => {
  return await api.get(`/showtimes/${showtimeId}`);
};

/** ผังที่นั่งพร้อมสถานะ AVAILABLE / HELD / BOOKED และราคาต่อโซน */
export const getSeatMap = async (showtimeId) => {
  return await api.get(`/showtimes/${showtimeId}/seats`);
};
