import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { apiError } from '../api/client.js';
import { register as registerApi } from '../api/auth.js';
import { useAuthStore, useIsAuthenticated } from '../store/authStore.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import Input from '../components/ui/Input.jsx';
import PasswordInput from '../components/ui/PasswordInput.jsx';

const EMPTY_FORM = { name: '', email: '', phone: '', password: '', confirm: '' };

const RegisterPage = () => {
  const { t } = useI18n();
  const setSession = useAuthStore((state) => state.setSession);
  const isAuthenticated = useIsAuthenticated();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldError, setFieldError] = useState({});
  const [busy, setBusy] = useState(false);

  const redirectTo = location.state?.from?.pathname
    ? `${location.state.from.pathname}${location.state.from.search ?? ''}`
    : '/';

  useEffect(() => {
    if (isAuthenticated) navigate(redirectTo, { replace: true });
  }, [isAuthenticated, navigate, redirectTo]);

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldError((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  /** ตรวจเท่าที่ตรวจได้ก่อนยิง API — ผู้ใช้จะได้ไม่ต้องรอ round trip เพื่อรู้ว่าพิมพ์รหัสไม่ตรงกัน */
  const validate = () => {
    const errors = {};
    if (form.name.trim().length < 2) errors.name = t('register.nameRequired');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = t('register.emailInvalid');
    if (!/^0[689]\d{8}$/.test(form.phone.replace(/\D/g, ''))) errors.phone = t('register.phoneInvalid');
    if (form.password.length < 8) errors.password = t('register.passwordTooShort');
    else if (!/[A-Za-z]/.test(form.password)) errors.password = t('register.passwordNeedsLetter');
    else if (!/[0-9]/.test(form.password)) errors.password = t('register.passwordNeedsNumber');
    if (form.confirm !== form.password) errors.confirm = t('register.confirmMismatch');

    setFieldError(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setBusy(true);
    try {
      const { data } = await registerApi(form);
      setSession(data);
      toast.success(t('register.success', { name: data.user.name }));
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const { code, message, details } = apiError(err);
      // 422 บอกมาเป็นรายช่อง ส่วน 409 บอกว่าอีเมล/เบอร์ซ้ำ — ชี้ให้ตรงช่องที่ต้องแก้ทั้งคู่
      if (Array.isArray(details) && details.length) {
        setFieldError(Object.fromEntries(details.map((item) => [item.field, item.message])));
      } else if (code === 'EMAIL_TAKEN') {
        setFieldError({ email: message });
      } else if (code === 'PHONE_TAKEN' || code === 'INVALID_PHONE') {
        setFieldError({ phone: message });
      } else {
        setFieldError({ form: message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col justify-center px-4 py-12">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-accent/15 p-2.5 text-accent">
            <UserPlus size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold">{t('register.title')}</h1>
            <p className="text-sm text-muted">{t('register.subtitle')}</p>
          </div>
        </div>

        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label={t('register.nameLabel')} required error={fieldError.name}>
            <Input
              autoFocus
              autoComplete="name"
              value={form.name}
              onChange={setField('name')}
              placeholder={t('register.namePlaceholder')}
            />
          </Field>

          <Field
            label={t('register.emailLabel')}
            required
            error={fieldError.email}
            hint={t('register.emailHint')}
          >
            <Input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={setField('email')}
              placeholder={t('register.emailPlaceholder')}
            />
          </Field>

          <Field
            label={t('register.phoneLabel')}
            required
            error={fieldError.phone}
            hint={t('register.phoneHint')}
          >
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={setField('phone')}
              placeholder={t('register.phonePlaceholder')}
            />
          </Field>

          <Field
            label={t('register.passwordLabel')}
            required
            error={fieldError.password}
            hint={t('register.passwordHint')}
          >
            <PasswordInput
              autoComplete="new-password"
              value={form.password}
              onChange={setField('password')}
              placeholder={t('register.passwordPlaceholder')}
            />
          </Field>

          <Field label={t('register.confirmLabel')} required error={fieldError.confirm}>
            <PasswordInput
              autoComplete="new-password"
              value={form.confirm}
              onChange={setField('confirm')}
              placeholder={t('register.confirmPlaceholder')}
            />
          </Field>

          {fieldError.form && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {fieldError.form}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-4" loading={busy}>
            {t('register.submit')}
          </Button>
        </form>

        <p className="mt-6 border-t border-line pt-4 text-center text-sm text-muted">
          {t('register.haveAccount')}{' '}
          <Link
            to="/login"
            state={location.state}
            className="font-semibold text-accent transition hover:underline"
          >
            {t('register.goLogin')}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
