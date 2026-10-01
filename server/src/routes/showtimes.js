import express from 'express';
import { z } from 'zod';

// controllers
import { listShowtimes, getShowtime, getSeatMap } from '../controllers/showtimes.js';
// middleware
import { validate } from '../middleware/validate.js';

const router = express.Router();

const listQuerySchema = z.object({
  movieId: z.string().min(1).optional(),
  theatreId: z.string().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD')
    .optional(),
});

// @ENDPOINT http://localhost:4000/api/showtimes
router.get('/', validate({ query: listQuerySchema }), listShowtimes);
// @ENDPOINT http://localhost:4000/api/showtimes/:id
router.get('/:id', getShowtime);
// @ENDPOINT http://localhost:4000/api/showtimes/:id/seats
router.get('/:id/seats', getSeatMap);

export default router;
