import { useState } from 'react';
import { KeyRound, Mail, Phone, UserRound } from 'lucide-react';
import { apiError } from '../api/client.js';
import { changePassword as changePasswordApi, updateProfile } from '../api/auth.js';
import { useAuthStore, useAuthUser } from '../store/authStore.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import Input from '../components/ui/Input.jsx';
import PasswordInput from '../components/ui/PasswordInput.jsx';

const EMPTY_PASSWORD_FORM = { currentPassword: '', newPassword: '', confirm: '' };

const ProfilePage = () => {
  const { t } = useI18n();
  const user = useAuthUser();
  const setUser = useAuthStore((state) => state.setUser);
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState(null);
  const [savingName, setSavingName] = useState(false);

  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [passwordError, setPasswordError] = useState({});
  const [savingPassword, setSavingPassword] = useState(false);

  const setPasswordField = (key) => (event) => {
    const { value } = event.target;
    setPasswordForm((current) => ({ ...current, [key]: value }));
    setPasswordError((current) => ({ ...current, [key]: undefined }));
  };

  const saveName = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameError(t('register.nameRequired'));
      return;
    }

    setSavingName(true);
    setNameError(null);
    try {
      const { data } = await updateProfile({ name: trimmed });
      // อัปเดต store ด้วย ชื่อบนแถบบนจะได้เปลี่ยนตามทันทีโดยไม่ต้องรีเฟรช
      setUser(data.user);
      toast.success(t('profile.nameSaved'));
    } catch (error) {
      setNameError(apiError(error).message);
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();

    const errors = {};
    if (!passwordForm.currentPassword) errors.currentPassword = t('profile.currentRequired');
    if (passwordForm.newPassword.length < 8) errors.newPassword = t('register.passwordTooShort');
    else if (!/[A-Za-z]/.test(passwordForm.newPassword)) errors.newPassword = t('register.passwordNeedsLetter');
    else if (!/[0-9]/.test(passwordForm.newPassword)) errors.newPassword = t('register.passwordNeedsNumber');
    else if (passwordForm.newPassword === passwordForm.currentPassword) {
      errors.newPassword = t('profile.sameAsCurrent');
    }
    if (passwordForm.confirm !== passwordForm.newPassword) errors.confirm = t('register.confirmMismatch');

    setPasswordError(errors);
    if (Object.keys(errors).length) return;

    setSavingPassword(true);
    try {
      const { data } = await changePasswordApi(passwordForm);
      // ใบเดิมถูกเพิกถอนทันทีที่เปลี่ยนรหัส ใช้ใบใหม่ที่ server ส่งมา คำขอถัดไปจะได้ไม่โดน 401
      setAccessToken(data.accessToken);
      setPasswordForm(EMPTY_PASSWORD_FORM);
      toast.success(t('profile.passwordSaved'));
    } catch (error) {
      const { code, message } = apiError(error);
      // รหัสเดิมผิดต้องชี้ที่ช่องบน ไม่ใช่ช่องรหัสใหม่ ผู้ใช้จะได้รู้ว่าต้องแก้ตรงไหน
      setPasswordError(code === 'WRONG_PASSWORD' ? { currentPassword: message } : { form: message });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb
        className="mb-4"
        items={[{ label: t('nav.home'), to: '/' }, { label: t('nav.profile') }]}
      />
      <h1 className="mb-1 text-h1 font-bold">{t('profile.title')}</h1>
      <p className="mb-6 text-body-2 text-muted sm:text-body-1">{t('profile.subtitle')}</p>

      <div className="flex flex-col gap-4">
        <section className="card p-5 sm:p-7">
          <h2 className="flex items-center gap-2 text-h2 font-bold">
            <UserRound size={20} className="text-accent" /> {t('profile.accountSection')}
          </h2>

          <form onSubmit={saveName} className="mt-4 flex flex-col gap-4">
            <Field label={t('register.nameLabel')} required error={nameError}>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-surface-2 px-3 py-3 sm:px-4">
                <p className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted sm:text-body-2">
                  <Mail size={14} /> {t('register.emailLabel')}
                </p>
                <p className="mt-1 truncate text-body-2 sm:text-body-1">{user?.email}</p>
              </div>
              <div className="rounded-xl bg-surface-2 px-3 py-3 sm:px-4">
                <p className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted sm:text-body-2">
                  <Phone size={14} /> {t('register.phoneLabel')}
                </p>
                <p className="mt-1 text-body-2 sm:text-body-1">{user?.phone}</p>
              </div>
            </div>
            <p className="text-caption text-muted sm:text-body-2">{t('profile.contactLocked')}</p>

            <div>
              <Button type="submit" loading={savingName} disabled={name.trim() === user?.name}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </section>

        <section className="card p-5 sm:p-7">
          <h2 className="flex items-center gap-2 text-h2 font-bold">
            <KeyRound size={20} className="text-accent" /> {t('profile.passwordSection')}
          </h2>
          {/* เยื้อง 28px = ไอคอนหัวข้อ 20px + gap-2 ให้คำเตือนตรงกับตัวหนังสือหัวข้อ อ่านเป็นคำอธิบายของหัวข้อนี้ */}
          <p className="mt-1 pl-7 text-caption text-muted sm:text-body-2">{t('profile.passwordNotice')}</p>

          <form onSubmit={savePassword} className="mt-4 flex flex-col gap-4">
            <Field
              label={t('profile.currentPassword')}
              required
              error={passwordError.currentPassword}
            >
              <PasswordInput
                autoComplete="current-password"
                value={passwordForm.currentPassword}
                onChange={setPasswordField('currentPassword')}
                placeholder={t('login.passwordPlaceholder')}
              />
            </Field>

            <Field
              label={t('profile.newPassword')}
              required
              error={passwordError.newPassword}
              hint={t('register.passwordHint')}
            >
              <PasswordInput
                autoComplete="new-password"
                value={passwordForm.newPassword}
                onChange={setPasswordField('newPassword')}
                placeholder={t('register.passwordPlaceholder')}
              />
            </Field>

            <Field label={t('register.confirmLabel')} required error={passwordError.confirm}>
              <PasswordInput
                autoComplete="new-password"
                value={passwordForm.confirm}
                onChange={setPasswordField('confirm')}
                placeholder={t('register.confirmPlaceholder')}
              />
            </Field>

            {passwordError.form && (
              <p className="rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-body-2 text-danger">
                {passwordError.form}
              </p>
            )}

            <div>
              <Button type="submit" loading={savingPassword}>
                {t('profile.changePassword')}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
};

export default ProfilePage;
