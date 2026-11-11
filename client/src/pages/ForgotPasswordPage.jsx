import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock, Mail } from 'lucide-react';
import { apiError } from '../api/client.js';
import { requestPasswordReset } from '../api/auth.js';
import { useI18n } from '../context/I18nContext.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import Input from '../components/ui/Input.jsx';

const ForgotPasswordPage = () => {
  const { t, lang } = useI18n();

  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(t('register.emailInvalid'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { data } = await requestPasswordReset({ email: value, lang });
      setSent(data);
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col justify-center px-4 py-12">
      {/* การ์ดพื้นเข้มขอบทอง ช่องกรอกพื้นทองอ่อน — ชุดเดียวกับหน้าเข้าสู่ระบบ/สมัครสมาชิก */}
      <div className="rounded-xl border border-gold-40 bg-cocoa-100 p-6 sm:p-8 [&_.input-base]:border-gold-50 [&_.input-base]:bg-gold-20 [&_.text-muted]:text-cream-30 [&_label>span:first-child]:text-body-1 [&_label>span:first-child]:text-fg!">
        <div className="mb-6 flex items-center gap-2">
          {sent ? (
            <Mail size={36} strokeWidth={1.5} className="shrink-0 text-gold-50" />
          ) : (
            <Lock size={32} fill="currentColor" className="shrink-0 text-gold-50 [&>path]:fill-none" />
          )}
          <div>
            <h1 className="text-h1 font-bold">{t(sent ? 'forgot.sentTitle' : 'forgot.title')}</h1>
            <p className="text-body-1 text-muted">{t(sent ? 'forgot.sentSubtitle' : 'forgot.subtitle')}</p>
          </div>
        </div>

        {sent ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-md border border-gold-50 bg-gold-30 px-3 py-2 text-body-2 text-cocoa-100">
              {t('forgot.sentBody', { email: email.trim(), minutes: sent.ttlMinutes })}
            </p>
            <p className="text-body-2 text-muted">{t('forgot.sentHint')}</p>

            {/* โหมดพัฒนาเท่านั้น: ยังไม่ได้ตั้งเซิร์ฟเวอร์อีเมล เลยเอาลิงก์มาวางให้กดต่อได้เลย
                ฝั่ง server ผูกเงื่อนไขกับ NODE_ENV ไว้แล้ว ขึ้นจริงจะไม่มีค่านี้ส่งมา */}
            {sent.devResetUrl && (
              <div className="rounded-xl border border-info/40 bg-info-bg p-3">
                <p className="mb-1 text-caption font-medium text-info">{t('forgot.devNotice')}</p>
                <a
                  href={sent.devResetUrl}
                  className="block break-all text-caption text-info underline"
                >
                  {sent.devResetUrl}
                </a>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-gold-60 pt-6">
              <Button variant="navy" onClick={() => setSent(null)}>
                {t('forgot.resend')}
              </Button>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-1.5 py-2 text-body-1 transition hover:text-accent"
              >
                <ArrowLeft size={18} className="text-gold-50" /> {t('forgot.backToLogin')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <Field
                label={t('forgot.emailLabel')}
                required
                error={error}
                hint={t('forgot.emailHint')}
              >
                <Input
                  autoFocus
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('register.emailPlaceholder')}
                />
              </Field>

              <Button
                type="submit"
                variant="navy"
                className="mt-4"
                loading={busy}
                disabled={!email.trim()}
              >
                {t('forgot.submit')}
              </Button>
            </form>

            <p className="mx-4 mt-10 border-t border-cream-40 pt-6 text-center text-body-1">
              <Link to="/login" className="inline-flex items-center gap-1.5 transition hover:text-accent">
                <ArrowLeft size={18} className="text-gold-50" /> {t('forgot.backToLogin')}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
