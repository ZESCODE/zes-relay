import { useCallback, useEffect, useState } from "react";
import { Api, errorMessage } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { toastStore } from "@/lib/hooks/useToast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { ApiToken } from "@/lib/types";

export function TokenTable() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await Api.get<{ tokens: ApiToken[] }>("/api/admin/tokens");
      setTokens(data.tokens);
    } catch (error) {
      toastStore.error("Cannot load tokens", errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toastStore.error("Name required", "Give the token a name you will recognise.");
      return;
    }
    setBusy(true);
    try {
      const data = await Api.post<{ name: string; token: string }>("/api/admin/tokens", {
        name: trimmed,
      });
      setCreated({ name: data.name, token: data.token });
      setName("");
      await load();
    } catch (error) {
      toastStore.error("Create failed", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [name, load]);

  const revoke = useCallback(
    async (token: ApiToken) => {
      setBusy(true);
      try {
        await Api.delete(`/api/admin/tokens/${token.id}`);
        setTokens((current) => current.filter((t) => t.id !== token.id));
        toastStore.success("Token revoked", token.name);
      } catch (error) {
        toastStore.error("Revoke failed", errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <>
      <Card>
        <CardHeader
          title="API tokens"
          subtitle="Authorization: Bearer pp_… for /api/* without a session cookie"
          actions={
            <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Reload tokens">
              <Icon name="refresh" size={14} />
            </Button>
          }
        />

        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="token name (e.g. termux-curl)"
            aria-label="Token name"
            className="flex-1"
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
          />
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            Create token
          </Button>
        </div>

        {tokens.length === 0 ? (
          <p className="text-sm text-[var(--frost-muted)]">
            No tokens yet. Tokens are optional — the browser session cookie is enough for the panel
            itself.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="glass-card p-3 flex items-center gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{token.name}</p>
                  <p className="text-xs text-[var(--frost-muted)] truncate">
                    <span className="font-mono">{token.prefix}…</span> · created{" "}
                    {fmtAgo(token.createdAt)} · used {token.useCount}×
                    {token.lastUsedAt ? ` · last ${fmtAgo(token.lastUsedAt)}` : " · never used"}
                  </p>
                </div>
                <Badge tone={token.lastUsedAt ? "green" : "neutral"} dot>
                  {token.lastUsedAt ? "active" : "unused"}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void revoke(token)}
                  aria-label={`Revoke ${token.name}`}
                  className="text-red-300"
                >
                  <Icon name="trash" size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Copy this token now"
        description="Only the HMAC digest is stored — this is the only time the plaintext is shown."
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            Done
          </Button>
        }
      >
        {created ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--frost-muted)]">{created.name}</p>
            <div className="flex gap-2">
              <code className="glass-input flex-1 overflow-x-auto whitespace-nowrap p-2 font-mono text-xs">
                {created.token}
              </code>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(created.token)
                    .then(() => toastStore.success("Copied to clipboard"))
                    .catch(() => toastStore.error("Clipboard blocked", "Select and copy manually."));
                }}
              >
                <Icon name="copy" size={14} />
              </Button>
            </div>
            <p className="text-xs text-[var(--frost-muted)] font-mono break-all">
              curl -H &quot;Authorization: Bearer {created.token.slice(0, 12)}…&quot;{" "}
              http://127.0.0.1:7178/api/models
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
