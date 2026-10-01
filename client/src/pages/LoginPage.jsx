import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { apiError } from "../api/client.js";
import { login as loginApi } from "../api/auth.js";
import { useAuthStore, useIsAuthenticated } from "../store/authStore.js";
import { useI18n } from "../context/I18nContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import Button from "../components/ui/Button.jsx";
import Field from "../components/ui/Field.jsx";
import Input from "../components/ui/Input.jsx";
import PasswordInput from "../components/ui/PasswordInput.jsx";

const LoginPage = () => {
  const { t } = useI18n();
  const setSession = useAuthStore((state) => state.setSession);
  const isAuthenticated = useIsAuthenticated();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // หน้าตั้งรหัสผ่านใหม่ส่งอีเมลของบัญชีมาให้ ผู้ใช้จะได้ไม่ต้องพิมพ์ซ้ำหลังรีเซ็ตเสร็จ
  const [form, setForm] = useState({
    identifier: location.state?.identifier ?? "",
    password: "",
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = location.state?.from?.pathname
    ? `${location.state.from.pathname}${location.state.from.search ?? ""}`
    : "/";

  useEffect(() => {
    if (isAuthenticated) navigate(redirectTo, { replace: true });
  }, [isAuthenticated, navigate, redirectTo]);

  const setField = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await loginApi(form);
      setSession(data);
      toast.success(t("login.welcome", { name: data.user.name }));
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    form.identifier.trim().length >= 4 && form.password.length > 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col justify-center px-4 py-12">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-accent/15 p-2.5 text-accent">
            <LogIn size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold">{t("login.title")}</h1>
            <p className="text-sm text-muted">{t("login.subtitle")}</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t("login.identifierLabel")} required>
            <Input
              autoFocus
              required
              autoComplete="username"
              value={form.identifier}
              onChange={setField("identifier")}
              placeholder={t("login.identifierPlaceholder")}
            />
          </Field>

          <Field label={t("login.passwordLabel")} required error={error}>
            <PasswordInput
              required
              autoComplete="current-password"
              value={form.password}
              onChange={setField("password")}
              placeholder={t("login.passwordPlaceholder")}
            />
          </Field>

          <p className="-mt-2 text-right">
            <Link
              to="/forgot-password"
              className="text-sm text-muted transition hover:text-accent"
            >
              {t("login.forgotPassword")}
            </Link>
          </p>

          <Button
            type="submit"
            size="lg"
            className="mt-4"
            loading={busy}
            disabled={!canSubmit}
          >
            {t("login.submit")}
          </Button>
        </form>

        <p className="mt-6 border-t border-line pt-4 text-center text-sm text-muted">
          {t("login.noAccount")}{" "}
          <Link
            to="/register"
            // ส่งปลายทางเดิมต่อไปด้วย คนที่กำลังจองที่นั่งค้างไว้จะได้กลับไปจองต่อหลังสมัครเสร็จ
            state={location.state}
            className="font-semibold text-accent transition hover:underline"
          >
            {t("login.goRegister")}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
