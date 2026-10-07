import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Models } from "@/pages/Models";
import { Playground } from "@/pages/Playground";
import { Logs } from "@/pages/Logs";
import { Config } from "@/pages/Config";
import { Admin } from "@/pages/Admin";
import { useSession } from "@/lib/hooks/useSession";
import { Spinner } from "@/components/ui/Spinner";

function Splash({ label }: { label: string }) {
  return (
    <div className="min-h-[100dvh] grid place-items-center gap-2 text-sm text-[var(--frost-muted)]">
      <div className="flex flex-col items-center gap-2">
        <Spinner size={24} label={label} />
        {label}
      </div>
    </div>
  );
}

/** Everything except /login requires a session cookie or an API token. */
export function AppRouter() {
  const { user, loading } = useSession();

  if (loading) return <Splash label="Checking session…" />;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/models" element={<Models />} />
      <Route path="/playground" element={<Playground />} />
      <Route path="/logs" element={<Logs />} />
      <Route path="/config" element={<Config />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
