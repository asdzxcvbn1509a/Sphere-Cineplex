import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import SiteLayout from './components/layout/SiteLayout.jsx';
import ProtectedRoute from './components/route/ProtectedRoute.jsx';
import AdminRoute from './components/route/AdminRoute.jsx';
import LoadingBlock from './components/ui/LoadingBlock.jsx';

// หน้าแรก (คนเข้ามาที่นี่มากที่สุด) กับหน้า 404 อยู่ในไฟล์หลักเลย ไม่ต้องรอโหลดเพิ่ม
import HomePage from './pages/HomePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

/**
 * หน้าอื่นโหลดโค้ดเมื่อเปิดหน้านั้นครั้งแรก (แยกไฟล์ตามหน้า)
 * เดิมทุกหน้ารวมถึงหลังบ้านอยู่ในไฟล์เดียว 620 KB ลูกค้าที่เปิดหน้าแรกต้องโหลดโค้ดหน้า admin
 * และตัวสร้าง QR ไปด้วยทั้งที่ไม่เคยใช้
 *
 * ใช้ `lazy` ของ route ไม่ใช่ React.lazy — router เริ่มโหลดไฟล์ทันทีที่ URL ตรง ขนานไปกับการกู้เซสชัน (bootstrap)
 * ถ้าใช้ React.lazy ใน <ProtectedRoute> ไฟล์จะเริ่มโหลดหลังรู้ผลล็อกอินแล้ว ช้าลงอีกหนึ่งจังหวะ
 * ตอนกดเปลี่ยนหน้า router รอไฟล์มาก่อนแล้วค่อยสลับ หน้าเดิมจึงค้างอยู่แทนที่จะกระพริบเป็น spinner
 *
 * render = วิธีแสดงหน้า เช่นห่อด้วย <ProtectedRoute> หรือส่ง prop
 * hydrateFallbackElement = สิ่งที่แสดงระหว่างรอไฟล์ตอนเปิดลิงก์ตรงเข้าหน้านั้น (layout ด้านบนยังแสดงตามปกติ)
 */
const lazyPage = (load, render = (Page) => <Page />) => ({
  lazy: async () => {
    const { default: Page } = await load();
    return { element: render(Page) };
  },
  hydrateFallbackElement: <LoadingBlock />,
});

const requireLogin = (Page) => (
  <ProtectedRoute>
    <Page />
  </ProtectedRoute>
);

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
      { path: 'movies/:movieId', ...lazyPage(() => import('./pages/MovieDetailPage.jsx')) },
      // ยังไม่บังคับล็อกอินตรงนี้ (Lazy Registration) — ไปบังคับตอนกดยืนยันการจอง
      { path: 'showtimes/:showtimeId/seats', ...lazyPage(() => import('./pages/SeatSelectionPage.jsx')) },
      { path: 'login', ...lazyPage(() => import('./pages/LoginPage.jsx')) },
      { path: 'register', ...lazyPage(() => import('./pages/RegisterPage.jsx')) },
      { path: 'forgot-password', ...lazyPage(() => import('./pages/ForgotPasswordPage.jsx')) },
      // token มาทาง ?token= ในลิงก์ที่ส่งไปทางอีเมล
      { path: 'reset-password', ...lazyPage(() => import('./pages/ResetPasswordPage.jsx')) },

      {
        path: 'booking/:bookingId/payment',
        ...lazyPage(() => import('./pages/PaymentPage.jsx'), requireLogin),
      },
      {
        path: 'booking/:bookingId/ticket',
        ...lazyPage(() => import('./pages/TicketPage.jsx'), requireLogin),
      },
      {
        path: 'booking/:bookingId/change-seats',
        ...lazyPage(() => import('./pages/ChangeSeatsPage.jsx'), requireLogin),
      },
      {
        // ชำระส่วนต่างของคำขอเปลี่ยนที่นั่งที่ย้ายไปที่แพงกว่า
        path: 'booking/:bookingId/seat-change/:changeId',
        ...lazyPage(() => import('./pages/SeatChangePaymentPage.jsx'), requireLogin),
      },
      {
        // ผู้ดูแลเปิดใบเสร็จของลูกค้าได้ด้วย (server ตรวจสิทธิ์เจ้าของหรือ ADMIN)
        path: 'booking/:bookingId/receipt',
        ...lazyPage(() => import('./pages/ReceiptPage.jsx'), requireLogin),
      },
      { path: 'my-bookings', ...lazyPage(() => import('./pages/MyBookingsPage.jsx'), requireLogin) },
      { path: 'profile', ...lazyPage(() => import('./pages/ProfilePage.jsx'), requireLogin) },
      { path: 'notifications', ...lazyPage(() => import('./pages/NotificationsPage.jsx'), requireLogin) },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    // ทั้งหลังบ้านแยกไฟล์ทั้งหมด ลูกค้าทั่วไปไม่ต้องโหลดโค้ดส่วนนี้เลย
    path: '/admin',
    ...lazyPage(
      () => import('./pages/admin/AdminLayout.jsx'),
      (AdminLayout) => (
        <AdminRoute>
          <AdminLayout />
        </AdminRoute>
      ),
    ),
    children: [
      { index: true, ...lazyPage(() => import('./pages/admin/AdminOverviewPage.jsx')) },
      { path: 'movies', ...lazyPage(() => import('./pages/admin/AdminMoviesPage.jsx')) },
      { path: 'theatres', ...lazyPage(() => import('./pages/admin/AdminTheatresPage.jsx')) },
      { path: 'showtimes', ...lazyPage(() => import('./pages/admin/AdminShowtimesPage.jsx')) },
      { path: 'bookings', ...lazyPage(() => import('./pages/admin/AdminBookingsPage.jsx')) },
      // ย้ายที่นั่งแทนลูกค้า — หน้าเดียวกับฝั่งลูกค้าในโหมดผู้ดูแล (โซนเดิมเท่านั้น + เหตุผล)
      {
        path: 'bookings/:bookingId/change-seats',
        ...lazyPage(() => import('./pages/ChangeSeatsPage.jsx'), (ChangeSeatsPage) => <ChangeSeatsPage admin />),
      },
      { path: 'users', ...lazyPage(() => import('./pages/admin/AdminUsersPage.jsx')) },
      { path: 'payments', ...lazyPage(() => import('./pages/admin/AdminPaymentsPage.jsx')) },
      { path: 'refunds', ...lazyPage(() => import('./pages/admin/AdminRefundsPage.jsx')) },
      { path: 'reports', ...lazyPage(() => import('./pages/admin/AdminReportsPage.jsx')) },
    ],
  },
]);

/**
 * deploy ใหม่แล้ว ไฟล์ของหน้าเวอร์ชันก่อนไม่มีแล้ว แท็บที่เปิดค้างไว้จึงเปิดหน้าถัดไปไม่ได้
 * Vite ส่ง event นี้เมื่อโหลดไฟล์ไม่สำเร็จ — โหลดใหม่ทั้งหน้าจะได้ index.html ตัวใหม่ที่ชี้ไฟล์ชุดปัจจุบัน
 * พาไปหน้าที่กำลังจะเปิดเลย (navigation.location) ไม่ใช่รีโหลดหน้าเดิมแล้วให้ผู้ใช้กดซ้ำ
 * กันวนไม่รู้จบ (เน็ตหลุด, ไฟล์เสียจริง): ถ้าเพิ่งโหลดใหม่ไปไม่ถึง 10 วินาที ปล่อยให้ error ขึ้นตามปกติ
 */
const CHUNK_RELOAD_KEY = 'cinebook.chunkReloadAt';
window.addEventListener('vite:preloadError', () => {
  try {
    if (Date.now() - Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0) < 10 * 1000) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // จำเวลาไม่ได้ก็กันวนไม่ได้ — ไม่โหลดใหม่ดีกว่าโหลดไม่หยุด
    return;
  }
  const pending = router.state.navigation.location;
  if (pending) window.location.assign(router.createHref(pending));
  else window.location.reload();
});

const App = () => {
  return <RouterProvider router={router} />;
};

export default App;
