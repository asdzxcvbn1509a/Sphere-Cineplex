# State machines

Every status change below is a compare-and-set update in `server/src/services/` (the expected status is part of the `WHERE`), so two actions racing for the same row can't both win — see [Concurrent status changes](architecture.md#concurrent-status-changes).
Durations come from [configuration](configuration.md): `SEAT_HOLD_MINUTES` (10), `REJECTED_RETRY_MINUTES` (10), `CANCEL_CUTOFF_HOURS` (3), `SEAT_CHANGE_CUTOFF_MINUTES` (30)
There is no transfer after the deadline: a slip is accepted only while a booking or seat change is `PENDING_PAYMENT`. Once it is `EXPIRED`, `POST …/slip` returns 409 `HOLD_EXPIRED`, which tells the customer to contact staff with the booking code

- [Booking](#booking)
- [Payment](#payment) — one model, three kinds: `BOOKING`, `SEAT_CHANGE_TOPUP`, `SEAT_CHANGE_REFUND`
- [Seat change](#seat-change)
- [Showtime](#showtime)

---

## Booking

`Booking.status` — the seats a booking holds are its `BookingSeat` rows; closing a booking (cancel or expiry) deletes them

```mermaid
stateDiagram-v2
    [*] --> PENDING_PAYMENT: create booking
    PENDING_PAYMENT --> PENDING_VERIFICATION: slip uploaded
    PENDING_PAYMENT --> EXPIRED: hold expired (job)
    PENDING_PAYMENT --> CANCELLED: cancelled by customer / admin / showtime cancellation
    PENDING_VERIFICATION --> PAID: admin approves slip
    PENDING_VERIFICATION --> PENDING_PAYMENT: admin rejects (showtime not started)
    PENDING_VERIFICATION --> EXPIRED: admin rejects after the showtime started
    PENDING_VERIFICATION --> CANCELLED: cancelled by admin
    PAID --> CANCELLED: cancelled by customer / admin / showtime cancellation
    CANCELLED --> [*]
    EXPIRED --> [*]
```

| From → to | Trigger | Notes |
|---|---|---|
| — → `PENDING_PAYMENT` | `POST /api/bookings` | Seats held for `SEAT_HOLD_MINUTES` (`holdExpiresAt`); a main `Payment` (`AWAITING_SLIP`) is created in the same transaction |
| `PENDING_PAYMENT` → `PENDING_VERIFICATION` | `POST /api/payments/:bookingId/slip` | `holdExpiresAt = null` stops the countdown; seats stay held until the admin decides. Accepted even past the deadline if the job hasn't released the seats yet (an upload that started in time and finished a few seconds late). When the upload races the job, exactly one wins: the slip enters review, or the booking expires and the upload gets 409 `HOLD_EXPIRED` |
| `PENDING_PAYMENT` → `EXPIRED` | Job, every 30 s | Seats released, payment `AWAITING_SLIP` → `REJECTED`, `expiredAt` set, `BOOKING_EXPIRED` notification. Final: no slip is accepted afterwards |
| `PENDING_PAYMENT` → `CANCELLED` | `POST /api/bookings/:id/cancel`, `POST /api/admin/bookings/:id/cancel`, `POST /api/admin/showtimes/:id/cancel` | Seats released, open payment closed as `REJECTED` |
| `PENDING_VERIFICATION` → `PAID` | `POST /api/admin/payments/:id/approve` | Receipt number issued in the same transaction; receipt emailed after commit |
| `PENDING_VERIFICATION` → `PENDING_PAYMENT` | `POST /api/admin/payments/:id/reject` | New hold of `REJECTED_RETRY_MINUTES` |
| `PENDING_VERIFICATION` → `EXPIRED` | `POST /api/admin/payments/:id/reject` after the showtime started | Seats released and the booking is closed; a new slip gets 409 `HOLD_EXPIRED`. The `PAYMENT_REJECTED` notification tells a customer who did pay to contact staff |
| `PENDING_VERIFICATION` → `CANCELLED` | `POST /api/admin/bookings/:id/cancel` | Customers can't cancel here (409 `AWAITING_VERIFICATION`), and a showtime with pending slips can't be cancelled (409 `SHOWTIME_HAS_PENDING_SLIPS`) |
| `PAID` → `CANCELLED` | Customer (≥ `CANCEL_CUTOFF_HOURS` before the showtime, refund account required), admin (any time) or showtime cancellation | Main payment `APPROVED` → `REFUND_PENDING` with `refundAmount` = the booking's net total. Blocked while a seat-change difference slip awaits review (409 `SEAT_CHANGE_AWAITING_VERIFICATION`) |

`PAID` bookings keep their status through seat changes; `seatSnapshot` and `totalAmount` are updated instead

---

## Payment

`Payment.status`, by `Payment.kind`. The kind and its columns are kept consistent by a CHECK constraint; `booking.payment` is the `BOOKING` payment (via `mainBookingId`)

### Ticket payment — `kind = BOOKING`

```mermaid
stateDiagram-v2
    [*] --> AWAITING_SLIP: booking created
    AWAITING_SLIP --> PENDING_VERIFICATION: slip uploaded
    AWAITING_SLIP --> REJECTED: booking expired / cancelled
    REJECTED --> PENDING_VERIFICATION: new slip after a rejection
    PENDING_VERIFICATION --> APPROVED: admin approves
    PENDING_VERIFICATION --> REJECTED: admin rejects / admin cancels the booking
    APPROVED --> REFUND_PENDING: paid booking cancelled
    REFUND_PENDING --> REFUNDED: admin records the refund transfer
    REFUNDED --> [*]
```

| From → to | Trigger | Notes |
|---|---|---|
| `AWAITING_SLIP` / `REJECTED` → `PENDING_VERIFICATION` | Slip upload while the booking is `PENDING_PAYMENT` (first slip, or a new one after a rejection) | The previous slip file is deleted after the new one is saved |
| `PENDING_VERIFICATION` → `APPROVED` | Approve | `receiptNo`, `receiptName` and `receiptSeats` are frozen on the payment |
| `APPROVED` → `REFUND_PENDING` | Booking cancelled after payment | `refundAmount` = `Booking.totalAmount` (net of seat-change differences); refund account from the cancel request, or added later via `PATCH /api/bookings/:id/refund-account` |
| `REFUND_PENDING` → `REFUNDED` | `POST /api/admin/refunds/:id/complete` (refund slip required) | `REFUND_COMPLETED` notification. `PATCH /api/admin/refunds/:id` can replace the slip or note later without changing the status |

### Seat-change difference to pay — `kind = SEAT_CHANGE_TOPUP`

```mermaid
stateDiagram-v2
    [*] --> AWAITING_SLIP: pricier seat change requested
    AWAITING_SLIP --> PENDING_VERIFICATION: difference slip uploaded
    AWAITING_SLIP --> REJECTED: request cancelled / expired / booking or showtime cancelled
    REJECTED --> PENDING_VERIFICATION: new slip after a rejection
    PENDING_VERIFICATION --> APPROVED: admin approves (seats move)
    PENDING_VERIFICATION --> REJECTED: admin rejects
    APPROVED --> [*]
```

Approving issues a separate difference receipt (`GET /api/bookings/:id/receipt?payment=<id>`). An approved difference is never refunded on its own: if the booking is cancelled later, it is included in the main payment's net `refundAmount`

### Seat-change difference to refund — `kind = SEAT_CHANGE_REFUND`

```mermaid
stateDiagram-v2
    [*] --> REFUND_PENDING: cheaper seat change completed
    REFUND_PENDING --> REFUNDED: admin records the refund transfer
    REFUNDED --> [*]
```

Created together with the completed seat change, with the refund account the customer entered

---

## Seat change

`SeatChange.status` — one open request (`PENDING_PAYMENT` or `PENDING_VERIFICATION`) per booking at a time. The customer's current seats are never touched until the change completes; the new seats are held as `BookingSeat` rows carrying the `seatChangeId`

```mermaid
stateDiagram-v2
    [*] --> COMPLETED: same or cheaper price (customer), or same zones (admin)
    [*] --> PENDING_PAYMENT: pricier seats (new seats held)
    PENDING_PAYMENT --> PENDING_VERIFICATION: difference slip uploaded
    PENDING_PAYMENT --> EXPIRED: hold expired (job)
    PENDING_PAYMENT --> CANCELLED: customer cancels / booking or showtime cancelled
    PENDING_VERIFICATION --> COMPLETED: admin approves
    PENDING_VERIFICATION --> PENDING_PAYMENT: admin rejects (showtime not started)
    PENDING_VERIFICATION --> EXPIRED: admin rejects after the showtime started
    COMPLETED --> [*]
    CANCELLED --> [*]
    EXPIRED --> [*]
```

| From → to | Trigger | Notes |
|---|---|---|
| — → `COMPLETED` | `POST /api/bookings/:id/seat-changes` (difference ≤ 0) or `POST /api/admin/bookings/:id/change-seats` | Seats moved in one transaction; a negative difference creates a `SEAT_CHANGE_REFUND` payment. Admin moves must keep every seat's zone (400 `SEAT_ZONE_MISMATCH`) and don't count toward the customer's quota |
| — → `PENDING_PAYMENT` | `POST /api/bookings/:id/seat-changes` (difference > 0) | New seats held for `SEAT_HOLD_MINUTES`; a `SEAT_CHANGE_TOPUP` payment is created |
| `PENDING_PAYMENT` → `PENDING_VERIFICATION` | `POST /api/seat-changes/:id/slip` | Same slip-submission code as ticket payments, including the race with the expiry job |
| `PENDING_PAYMENT` → `EXPIRED` | Job, every 30 s | Held new seats released, top-up `AWAITING_SLIP` → `REJECTED`, `SEAT_CHANGE_EXPIRED` notification. Final: a difference slip gets 409 `HOLD_EXPIRED` |
| `PENDING_PAYMENT` → `CANCELLED` | `POST /api/seat-changes/:id/cancel`, booking cancellation, showtime cancellation | Not allowed once the slip is uploaded (409 `SEAT_CHANGE_AWAITING_VERIFICATION`) |
| `PENDING_VERIFICATION` → `COMPLETED` | `POST /api/admin/payments/:id/approve` | Booking's `seatSnapshot` / `totalAmount` updated, held seats become the booking's seats, difference receipt issued |
| `PENDING_VERIFICATION` → `PENDING_PAYMENT` | `POST /api/admin/payments/:id/reject` | New hold of `REJECTED_RETRY_MINUTES`; the new seats stay held |
| `PENDING_VERIFICATION` → `EXPIRED` | Reject after the showtime started | Held new seats released; the customer keeps the original seats |

Quota: at most `MAX_SEAT_CHANGES_PER_BOOKING` customer requests per booking count — `PENDING_PAYMENT`, `PENDING_VERIFICATION` and `COMPLETED` requests made by the customer; expired, cancelled and admin moves don't count

---

## Showtime

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED: admin creates showtime
    SCHEDULED --> CANCELLED: admin cancels the whole showtime
    CANCELLED --> [*]
```

`POST /api/admin/showtimes/:id/cancel` closes every `PENDING_PAYMENT` / `PAID` booking and open seat-change request in one transaction, queues refunds for paid bookings and notifies every customer. It is refused while any slip of that showtime awaits review (409 `SHOWTIME_HAS_PENDING_SLIPS`) and after the showtime has ended (409 `SHOWTIME_ENDED`). `PATCH /api/admin/showtimes/:id` can't change the status
