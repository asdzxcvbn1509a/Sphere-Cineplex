import express from 'express';
import { z } from 'zod';

// controllers
import { listMovies, getMovie } from '../controllers/movies.js';
// middleware
import { validate } from '../middleware/validate.js';

const router = express.Router();

const listQuerySchema = z.object({
  status: z.enum(['NOW_SHOWING', 'COMING_SOON', 'ARCHIVED']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

// @ENDPOINT http://localhost:4000/api/movies
router.get('/', validate({ query: listQuerySchema }), listMovies);
// @ENDPOINT http://localhost:4000/api/movies/:id
router.get('/:id', getMovie);

export default router;
