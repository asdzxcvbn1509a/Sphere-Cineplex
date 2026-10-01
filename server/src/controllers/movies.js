import * as movieService from '../services/movies.js';

// @ENDPOINT GET http://localhost:4000/api/movies
export const listMovies = async (req, res, next) => {
  try {
    const movies = await movieService.listMovies(req.validatedQuery);
    res.json({ movies });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/movies/:id
export const getMovie = async (req, res, next) => {
  try {
    const movie = await movieService.getMovieById(req.params.id);
    res.json({ movie });
  } catch (error) {
    next(error);
  }
};
