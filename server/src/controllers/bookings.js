import * as bookingService from '../services/bookings.js';

// @ENDPOINT POST http://localhost:4000/api/bookings
export const createBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.createBooking({
      userId: req.user.id,
      ...req.body,
    });
    res.status(201).json({ booking });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/bookings
export const listMyBookings = async (req, res, next) => {
  try {
    const bookings = await bookingService.listMyBookings(req.user.id, req.validatedQuery);
    res.json({ bookings });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/bookings/:id
export const getBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingById(req.params.id, { userId: req.user.id });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT GET http://localhost:4000/api/bookings/:id/ticket
export const getTicket = async (req, res, next) => {
  try {
    const ticket = await bookingService.getTicket({
      bookingId: req.params.id,
      userId: req.user.id,
    });
    res.json({ ticket });
  } catch (error) {
    next(error);
  }
};

// @ENDPOINT POST http://localhost:4000/api/bookings/:id/cancel
export const cancelBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.cancelBooking({
      bookingId: req.params.id,
      userId: req.user.id,
      reason: req.body.reason,
      refundAccount: {
        bankName: req.body.refundBankName,
        accountNo: req.body.refundAccountNo,
      },
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
};
