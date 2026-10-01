import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiError } from '../api/client.js';
import { checkResetToken, resetPassword } from '../api/auth.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import PasswordInput from '../components/ui/PasswordInput.jsx';

const ResetPasswordPage = () => {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const token = searchParams.get('token') ?? '';

  // checking → ready → (ส่งสำเร็จแล้วเด้งไปหน้าล็อกอิน) · invalid = ลิงก์ผิดหรือหมดอายุ
  const [status, setStatus] = useState('checking');
  const [account, setAccount] = useState(null);
  const [linkError, setLinkError] = useState(null);

  const [form, setForm] = useState({ password: '', confirm: '' });
  const [fieldError, setFieldError] = useState({});
  const [busy, setBusy] = useState(false);

  /**
   * ตรวจลิงก์ก่อนแสดงฟอร์ม ผู้ใช้จะได้ไม่ตั้งรหัสใหม่จนเสร็จแล้วค่อยมารู้ว่าลิงก์หมดอายุไปแล้ว
   * ไม่ใส่ t ใน deps เพราะสลับภาษาทีจะยิง API ซ้ำโดยไม่จำเป็น
   */
  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setLinkError(null);
      setStatus('invalid');
      return undefined;
    }

    checkResetToken(token)
      .then(({ data }) => {
        if (cancelled) return;
        setAccount(data);
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setLinkError(apiError(error).message);
        setStatus('invalid');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldError((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();

    const errors = {};
    if (form.password.length < 8) errors.password = t('register.passwordTooShort');
    else if (!/[A-Za-z]/.test(form.password)) errors.password = t('register.passwordNeedsLetter');
    else if (!/[0-9]/.test(form.password)) errors.password = t('register.passwordNeedsNumber');
    if (form.confirm !== form.password) errors.confirm = t('register.confirmMismatch');

    setFieldError(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      const { data } = await resetPassword({ token, password: form.password });
      toast.success(t('reset.success'));
      // ไม่ล็อกอินให้เอง ส่งอีเมลไปเติมในช่องที่หน้าล็อกอินแทน
      // ผู้ใช้จะได้ลองพิมพ์รหัสที่เพิ่งตั้งตั้งแต่ตอนนี้ ไม่ใช่ไปงงเอาตอนเข้าครั้งหน้า
      navigate('/login', { replace: true, state: { identifier: data.email } });
    } catch (error) {
      const { code, message } = apiError(error);
      // ลิงก์หมดอายุระหว่างที่กำลังกรอกอยู่ ต้องพาไปขอใหม่ ไม่ใช่ค้างให้กดซ้ำเปล่า ๆ
      if (code === 'RESET_LINK_INVALID' || code === 'RESET_LINK_EXPIRED') {
        setLinkError(message);
        setStatus('invalid');
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
        {status === 'checking' && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Loader2 size={18} className="animate-spin" /> {t('reset.checking')}
          </p>
        )}

        {status === 'invalid' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-danger/15 p-2.5 text-danger">
                <ShieldAlert size={20} />
              </span>
              <div>
                <h1 className="text-2xl font-bold">{t('reset.invalidTitle')}</h1>
                <p className="text-sm text-muted">{linkError ?? t('reset.missingToken')}</p>
              </div>
            </div>
            <Button as={Link} to="/forgot-password" size="lg" className="w-full">
              {t('reset.requestNew')}
            </Button>
            <Button as={Link} to="/login" variant="ghost" className="w-full">
              {t('forgot.backToLogin')}
            </Button>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="mb-6 flex items-center gap-3">
              <span className="rounded-xl bg-accent/15 p-2.5 text-accent">
                <KeyRound size={20} />
              </span>
              <div>
                <h1 className="text-2xl font-bold">{t('reset.title')}</h1>
                <p className="text-sm text-muted">
                  {t('reset.forAccount', { email: account?.email ?? '' })}
                </p>
              </div>
            </div>

            <p className="mb-4 flex items-start gap-1.5 text-sm text-muted">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" /> {t('reset.signedOutNotice')}
            </p>

            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <Field
                label={t('profile.newPassword')}
                required
                error={fieldError.password}
                hint={t('register.passwordHint')}
              >
                <PasswordInput
                  autoFocus
                  autoComplete="new-password"
                  value={form.password}
                  onChange={setField('password')}
                />
              </Field>

              <Field label={t('register.confirmLabel')} required error={fieldError.confirm}>
                <PasswordInput
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={setField('confirm')}
                />
              </Field>

              {fieldError.form && (
                <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {fieldError.form}
                </p>
              )}

              <Button type="submit" size="lg" className="mt-4" loading={busy}>
                {t('reset.submit')}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
