import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Pencil, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { apiError } from '../../api/client.js';
import { deleteUser, listUsers, resetUserPassword, updateUser } from '../../api/admin.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuthUser } from '../../store/authStore.js';
import Button from '../../components/ui/Button.jsx';
import ConfirmModal from '../../components/ui/ConfirmModal.jsx';
import Field from '../../components/ui/Field.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import PasswordInput from '../../components/ui/PasswordInput.jsx';
import ErrorBlock from '../../components/ui/ErrorBlock.jsx';
import LoadingBlock from '../../components/ui/LoadingBlock.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { usePagedApi } from '../../hooks/useApi.js';
import { formatDateTime } from '../../utils/format.js';

const EMPTY_EDIT = { name: '', email: '', phone: '', role: 'USER' };

const AdminUsersPage = () => {
  const { t, lang } = useI18n();
  const toast = useToast();
  const me = useAuthUser();

  // page อยู่ใน filters ด้วย — เปลี่ยนตัวกรองแล้วกลับหน้า 1 ได้ในการ set ครั้งเดียว
  const [filters, setFilters] = useState({ q: '', role: '', page: 1 });
  const [search, setSearch] = useState('');

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [editError, setEditError] = useState({});

  const [passwordTarget, setPasswordTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  // หน้าสุดท้ายว่างลงหลังลบบัญชี — usePagedApi พาไปหน้าสุดท้ายที่ยังมีรายการแทนโชว์ตารางว่าง
  const setPage = useCallback((page) => setFilters((current) => ({ ...current, page })), []);
  const { data, loading, error, reload } = usePagedApi(
    async () => {
      const { data: body } = await listUsers(filters);
      return { items: body.users, total: body.total, pageSize: body.pageSize };
    },
    { page: filters.page, setPage },
    [filters],
  );
  const users = data?.items ?? [];

  // พิมพ์ไปค้นไป หน่วง 400ms หลังหยุดพิมพ์ ไม่ให้ยิง API ทุกตัวอักษร
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = search.trim();
      setFilters((current) => (current.q === q ? current : { ...current, q, page: 1 }));
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const openEdit = (user) => {
    setEditForm({ name: user.name, email: user.email, phone: user.phone, role: user.role });
    setEditError({});
    setEditTarget(user);
  };

  const setEditField = (key) => (event) => {
    const { value } = event.target;
    setEditForm((current) => ({ ...current, [key]: value }));
    setEditError((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await updateUser(editTarget.id, editForm);
      toast.success(t('admin.userPage.saved'));
      setEditTarget(null);
      reload();
    } catch (error) {
      const { code, message, details } = apiError(error);
      if (Array.isArray(details) && details.length) {
        setEditError(Object.fromEntries(details.map((item) => [item.field, item.message])));
      } else if (code === 'EMAIL_TAKEN') {
        setEditError({ email: message });
      } else if (code === 'PHONE_TAKEN' || code === 'INVALID_PHONE') {
        setEditError({ phone: message });
      } else {
        setEditError({ form: message });
      }
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setPasswordError(null);
    if (newPassword.length < 8) return setPasswordError(t('register.passwordTooShort'));
    if (!/[A-Za-z]/.test(newPassword)) return setPasswordError(t('register.passwordNeedsLetter'));
    if (!/[0-9]/.test(newPassword)) return setPasswordError(t('register.passwordNeedsNumber'));

    setBusy(true);
    try {
      await resetUserPassword(passwordTarget.id, newPassword);
      toast.success(t('admin.userPage.passwordReset', { name: passwordTarget.name }));
      setPasswordTarget(null);
      setNewPassword('');
    } catch (error) {
      setPasswordError(apiError(error).message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteUser(deleteTarget.id);
      toast.success(t('admin.userPage.deleted'));
      setDeleteTarget(null);
      reload();
    } catch (error) {
      toast.error(apiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">{t('admin.userPage.title')}</h1>
      <p className="mb-5 text-sm text-muted">{t('admin.userPage.subtitle')}</p>

      <div className="mb-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end">
        <Field label={t('admin.userPage.role')} className="sm:w-44">
          <Select
            value={filters.role}
            onChange={(event) =>
              setFilters((current) => ({ ...current, role: event.target.value, page: 1 }))
            }
          >
            <option value="">{t('common.all')}</option>
            <option value="USER">{t('admin.userPage.roleUSER')}</option>
            <option value="ADMIN">{t('admin.userPage.roleADMIN')}</option>
          </Select>
        </Field>

        <Field label={t('common.search')} className="sm:min-w-56 sm:flex-1">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={15}
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('admin.userPage.searchPlaceholder')}
              className="pl-9"
            />
          </div>
        </Field>
      </div>

      {loading && <LoadingBlock label={t('common.loading')} />}
      {error && <ErrorBlock message={error} onRetry={reload} retryLabel={t('common.retry')} />}

      {!loading && !error && (
        <div className="card overflow-x-auto">
          {/* จอแคบกว่า lg แต่ละแถวเป็นการ์ด (.stack-table) — data-label คือชื่อคอลัมน์ที่โชว์กำกับในการ์ด */}
          <table className="stack-table w-full min-w-190 text-sm">
            <thead className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{t('admin.userPage.user')}</th>
                <th className="px-4 py-3 font-medium">{t('register.phoneLabel')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.userPage.role')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('admin.userPage.bookings')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.userPage.joined')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    {t('common.empty')}
                  </td>
                </tr>
              )}
              {users.map((user) => {
                const isMe = user.id === me?.id;
                return (
                  <tr key={user.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{user.name}</span>
                      {isMe && (
                        <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                          {t('admin.userPage.you')}
                        </span>
                      )}
                      <p className="text-[11px] text-muted">{user.email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted" data-label={t('register.phoneLabel')}>
                      {user.phone}
                    </td>
                    <td className="px-4 py-3" data-label={t('admin.userPage.role')}>
                      <span
                        className={clsx(
                          'rounded-md border px-2 py-1 text-[11px]',
                          user.role === 'ADMIN'
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-line text-muted',
                        )}
                      >
                        {t(`admin.userPage.role${user.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" data-label={t('admin.userPage.bookings')}>
                      {user.bookingCount > 0 ? (
                        // ลิงก์ไปหน้าการจองพร้อมคำค้น จะได้ไม่ต้องพิมพ์เบอร์ซ้ำตอนลูกค้าโทรมาถาม
                        <Link
                          to={`/admin/bookings?q=${encodeURIComponent(user.phone)}`}
                          className="font-semibold text-accent transition hover:underline"
                        >
                          {user.bookingCount}
                        </Link>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-muted" data-label={t('admin.userPage.joined')}>
                      {formatDateTime(user.createdAt, lang)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('common.edit')}
                          onClick={() => openEdit(user)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isMe}
                          title={isMe ? t('admin.userPage.selfPasswordHint') : t('admin.userPage.resetTitle')}
                          onClick={() => {
                            setNewPassword('');
                            setPasswordError(null);
                            setPasswordTarget(user);
                          }}
                        >
                          <KeyRound size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isMe || user.bookingCount > 0}
                          title={user.bookingCount > 0 ? t('admin.userPage.deleteBlocked') : undefined}
                          onClick={() => setDeleteTarget(user)}
                        >
                          <Trash2 size={14} className={isMe || user.bookingCount > 0 ? '' : 'text-danger'} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && (
        <Pagination
          className="mt-4"
          page={filters.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={setPage}
        />
      )}

      <ConfirmModal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={t('admin.userPage.editTitle')}
        cancelLabel={t('common.close')}
        confirmLabel={t('common.save')}
        variant="primary"
        loading={busy}
        onConfirm={saveEdit}
      >
        <div className="flex flex-col gap-3">
          <Field label={t('register.nameLabel')} error={editError.name}>
            <Input value={editForm.name} onChange={setEditField('name')} maxLength={60} />
          </Field>
          <Field label={t('register.emailLabel')} error={editError.email}>
            <Input type="email" value={editForm.email} onChange={setEditField('email')} />
          </Field>
          <Field label={t('register.phoneLabel')} error={editError.phone}>
            <Input type="tel" value={editForm.phone} onChange={setEditField('phone')} />
          </Field>
          <Field
            label={t('admin.userPage.role')}
            error={editError.role}
            hint={editTarget?.id === me?.id ? t('admin.userPage.selfRoleHint') : undefined}
          >
            <Select
              value={editForm.role}
              disabled={editTarget?.id === me?.id}
              onChange={setEditField('role')}
            >
              <option value="USER">{t('admin.userPage.roleUSER')}</option>
              <option value="ADMIN">{t('admin.userPage.roleADMIN')}</option>
            </Select>
          </Field>
          {editError.form && <p className="text-sm text-danger">{editError.form}</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(passwordTarget)}
        onClose={() => setPasswordTarget(null)}
        title={t('admin.userPage.resetTitle')}
        cancelLabel={t('common.close')}
        confirmLabel={t('admin.userPage.resetConfirm')}
        variant="primary"
        loading={busy}
        onConfirm={savePassword}
      >
        <p className="mb-4 text-sm text-muted">
          {t('admin.userPage.resetBody', { name: passwordTarget?.name })}
        </p>
        <Field
          label={t('profile.newPassword')}
          required
          error={passwordError}
          hint={t('register.passwordHint')}
        >
          <PasswordInput
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.userPage.deleteTitle')}
        cancelLabel={t('common.close')}
        confirmLabel={t('common.delete')}
        loading={busy}
        onConfirm={confirmDelete}
      >
        <p className="text-sm text-muted">
          {t('admin.userPage.deleteBody', { name: deleteTarget?.name, email: deleteTarget?.email })}
        </p>
      </ConfirmModal>
    </div>
  );
};

export default AdminUsersPage;
