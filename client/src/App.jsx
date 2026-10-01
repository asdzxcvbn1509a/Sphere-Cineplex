import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import SiteLayout from './components/layout/SiteLayout.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import ProtectedRoute from './components/route/ProtectedRoute.jsx';
import AdminRoute from './components/route/AdminRoute.jsx';

import HomePage from './pages/HomePage.jsx';
import MovieDetailPage from './pages/MovieDetailPage.jsx';
import SeatSelectionPage from './pages/SeatSelectionPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import PaymentPage from './pages/PaymentPage.jsx';
import TicketPage from './pages/TicketPage.jsx';
import MyBookingsPage from './pages/MyBookingsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

import AdminOverviewPage from './pages/admin/AdminOverviewPage.jsx';
import AdminMoviesPage from './pages/admin/AdminMoviesPage.jsx';
import AdminTheatresPage from './pages/admin/AdminTheatresPage.jsx';
import AdminShowtimesPage from './pages/admin/AdminShowtimesPage.jsx';
import AdminBookingsPage from './pages/admin/AdminBookingsPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage.jsx';
import AdminRefundsPage from './pages/admin/AdminRefundsPage.jsx';
import AdminReportsPage from './pages/admin/AdminReportsPage.jsx';

/**
 * Data Mode ของ react-router-dom v7
 * ประกาศเส้นทางเป็นอาร์เรย์ของออบเจกต์แล้วส่งให้ createBrowserRouter
 * แทนการเขียน <Routes>/<Route> เป็น JSX (Declarative Mode)
 *
 * โหมดนี้เปิดทางให้ใช้ loader / action / errorElement ต่อได้ในอนาคต
 * และ "ไม่ต้องมี <BrowserRouter> ครอบใน main.jsx อีก" เพราะ RouterProvider ทำหน้าที่แทน
 */
const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'movies/:movieId', element: <MovieDetailPage /> },
      // ยังไม่บังคับล็อกอินตรงนี้ (Lazy Registration) — ไปบังคับตอนกดยืนยันการจอง
      { path: 'showtimes/:showtimeId/seats', element: <SeatSelectionPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      // token มาทาง ?token= ในลิงก์ที่ส่งไปทางอีเมล
      { path: 'reset-password', element: <ResetPasswordPage /> },

      {
        path: 'booking/:bookingId/payment',
        element: (
          <ProtectedRoute>
            <PaymentPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'booking/:bookingId/ticket',
        element: (
          <ProtectedRoute>
            <TicketPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'my-bookings',
        element: (
          <ProtectedRoute>
            <MyBookingsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'profile',
        element: (
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'notifications',
        element: (
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        ),
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/admin',
    element: (
      <AdminRoute>
        <AdminLayout />
      </AdminRoute>
    ),
    children: [
      { index: true, element: <AdminOverviewPage /> },
      { path: 'movies', element: <AdminMoviesPage /> },
      { path: 'theatres', element: <AdminTheatresPage /> },
      { path: 'showtimes', element: <AdminShowtimesPage /> },
      { path: 'bookings', element: <AdminBookingsPage /> },
      { path: 'users', element: <AdminUsersPage /> },
      { path: 'payments', element: <AdminPaymentsPage /> },
      { path: 'refunds', element: <AdminRefundsPage /> },
      { path: 'reports', element: <AdminReportsPage /> },
    ],
  },
]);

const App = () => {
  return <RouterProvider router={router} />;
};

export default App;
