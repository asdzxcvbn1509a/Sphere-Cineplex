import * as showtimeService from '../services/showtimes.js';

// @ENDPOINT GET http://localhost:4000/api/showtimes
export const listShowtimes = async (req, res, next) => {
  try {
    const showtimes = await showtimeService.listShowtimes(req.validatedQuery);
    res.json({ showtimes });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/showtimes/:id
export const getShowtime = async (req, res, next) => {
  try {
    const showtime = await showtimeService.getShowtimeById(req.params.id);
    res.json({ showtime });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/showtimes/:id/seats
export const getSeatMap = async (req, res, next) => {
  try {
    res.json(await showtimeService.getSeatMap(req.params.id));
  } catch (error) {
    next(error);
  }
};
