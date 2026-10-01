import { releaseExpiredHolds } from '../services/bookings.js';
import { sendShowtimeReminders } from './reminders.js';

const timers = [];

/** ตั้ง interval ที่กันไม่ให้ error ทำให้ process ตาย และไม่ให้รอบซ้อนกัน */
const scheduleJob = (name, task, intervalMs) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const count = await task();
      if (count) console.log(`[job] ${name}: ${count} รายการ`);
    } catch (err) {
      console.error(`[job] ${name} ล้มเหลว:`, err.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  timers.push(timer);
  run();
};

export const startBackgroundJobs = () => {
  scheduleJob('ปล่อยที่นั่งที่หมดเวลาชำระเงิน', releaseExpiredHolds, 30 * 1000);
  scheduleJob('แจ้งเตือนก่อนรอบฉาย', sendShowtimeReminders, 60 * 1000);
};

export const stopBackgroundJobs = () => {
  while (timers.length) clearInterval(timers.pop());
};
