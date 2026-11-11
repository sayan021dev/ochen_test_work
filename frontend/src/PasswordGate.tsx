import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { Brand } from "./Brand";
import "./panels.css";
export type PasswordGateProps = {
  onLogin: (password: string) => Promise<void>;
};
export function PasswordGate({ onLogin }: PasswordGateProps) {
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    active = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || !password) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onLogin(password);
    } catch (cause) {
      if (active.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось войти. Попробуйте ещё раз.",
        );
        setPassword("");
      }
    } finally {
      pending.current = false;
      if (active.current) {
        setBusy(false);
        requestAnimationFrame(() => {
          if (active.current) input.current?.focus();
        });
      }
    }
  };
  return (
    <main className="sb-password-page">
      <Brand className="sb-access-brand" />
      <form
        className="sb-password-card"
        onSubmit={(event) => void submit(event)}
      >
        <div className="sb-access-icon">
          <LockKeyhole size={23} />
        </div>
        <h1>Идеи начинаются здесь</h1>
        <p className="sb-description">
          Введите пароль, чтобы открыть конструктор.
        </p>
        <label className="sb-field" htmlFor="access-password">
          Пароль доступа
        </label>
        <input
          id="access-password"
          ref={input}
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          disabled={busy}
          value={password}
          aria-invalid={!!error}
          aria-describedby={error ? "access-error" : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
            setError("");
          }}
        />
        {error && (
          <p id="access-error" role="alert" className="sb-error">
            {error}
          </p>
        )}
        <button
          className="sb-primary"
          type="submit"
          disabled={busy || !password}
        >
          {busy ? <LoaderCircle size={17} className="sb-spin" /> : null}Войти
          {!busy && <ArrowRight size={17} />}
        </button>
      </form>
      <span className="sb-access-caption">
        Конструктор векторных иллюстраций
      </span>
    </main>
  );
}
