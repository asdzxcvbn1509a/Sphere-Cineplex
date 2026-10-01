import api from './client.js';

/** รายการภาพยนตร์ที่เปิดให้ผู้ใช้ทั่วไปเห็น (ไม่รวมเรื่องที่ ARCHIVED) */
export const listMovies = async ({ status, q } = {}) => {
  return await api.get('/movies', {
    params: {
      ...(status && { status }),
      ...(q && { q }),
    },
  });
};

/** รายละเอียดภาพยนตร์ พร้อม availableDates = วันที่ที่ยังมีรอบฉายให้จอง */
export const getMovie = async (movieId) => {
  return await api.get(`/movies/${movieId}`);
};
