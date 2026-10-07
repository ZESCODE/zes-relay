import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Field, Input } from "@/components/ui/Input";
import { useSession } from "@/lib/hooks/useSession";

export function Login() {
  const { login, error, loading } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await login(username, password);
    setBusy(false);
  };

  return (
    <div className="min-h-[100dvh] grid place-items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl glass-btn-primary">
            <Icon name="bolt" size={20} className="text-white" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">pol-panel</h1>
            <p className="text-xs text-[var(--frost-muted)]">control panel for zes-relay</p>
          </div>
        </div>

        <Card className="p-4 sm:p-5">
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Field label="Username" htmlFor="login-username">
              <Input
                id="login-username"
                value={username}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </Field>
            <Field label="Password" htmlFor="login-password">
              <Input
                id="login-password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>

            {error ? (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" size="lg" block loading={busy || loading}>
              Sign in
            </Button>
          </form>

          <p className="mt-3 text-xs text-[var(--frost-muted)] leading-relaxed">
            First run? The generated password is printed to the sidecar log and written to{" "}
            <span className="font-mono">data/FIRST-RUN.txt</span> (mode 0600). Set{" "}
            <span className="font-mono">PANEL_ADMIN_USER</span> /{" "}
            <span className="font-mono">PANEL_ADMIN_PASSWORD</span> to choose your own.
          </p>
        </Card>

        <p className="mt-3 text-center text-[11px] text-[var(--frost-muted)]">
          Sessions are httpOnly cookies. No token is stored in localStorage.
        </p>
      </div>
    </div>
  );
}
