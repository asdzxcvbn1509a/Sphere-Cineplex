import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound, MailCheck } from 'lucide-react';
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
      <div className="card p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-accent/15 p-2.5 text-accent">
            {sent ? <MailCheck size={20} /> : <KeyRound size={20} />}
          </span>
          <div>
            <h1 className="text-2xl font-bold">{t(sent ? 'forgot.sentTitle' : 'forgot.title')}</h1>
            <p className="text-sm text-muted">{t(sent ? 'forgot.sentSubtitle' : 'forgot.subtitle')}</p>
          </div>
        </div>

        {sent ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-xl bg-surface-2 p-4 text-sm leading-relaxed">
              {t('forgot.sentBody', { email: email.trim(), minutes: sent.ttlMinutes })}
            </p>
            <p className="text-sm text-muted">{t('forgot.sentHint')}</p>

            {/* โหมดพัฒนาเท่านั้น: ยังไม่ได้ตั้งเซิร์ฟเวอร์อีเมล เลยเอาลิงก์มาวางให้กดต่อได้เลย
                ฝั่ง server ผูกเงื่อนไขกับ NODE_ENV ไว้แล้ว ขึ้นจริงจะไม่มีค่านี้ส่งมา */}
            {sent.devResetUrl && (
              <div className="rounded-xl border border-info/40 bg-info/10 p-3">
                <p className="mb-1 text-xs font-semibold text-info">{t('forgot.devNotice')}</p>
                <a
                  href={sent.devResetUrl}
                  className="block break-all text-xs text-info underline"
                >
                  {sent.devResetUrl}
                </a>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <Button variant="secondary" size="lg" onClick={() => setSent(null)}>
                {t('forgot.resend')}
              </Button>
              <Button as={Link} to="/login" variant="ghost">
                <ArrowLeft size={16} /> {t('forgot.backToLogin')}
              </Button>
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
                size="lg"
                className="mt-4"
                loading={busy}
                disabled={!email.trim()}
              >
                {t('forgot.submit')}
              </Button>
            </form>

            <p className="mt-6 border-t border-line pt-4 text-center text-sm">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-muted transition hover:text-fg"
              >
                <ArrowLeft size={14} /> {t('forgot.backToLogin')}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
