import { cn } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { newId } from "@/lib/format";
import type { ChatMessage } from "@/lib/types";

export interface MessageListProps {
  messages: ChatMessage[];
  onChange: (messages: ChatMessage[]) => void;
  busy?: boolean;
}

const ROLE_TONE: Record<ChatMessage["role"], string> = {
  system: "border-violet-400/40 bg-violet-500/10",
  user: "border-indigo-400/40 bg-indigo-500/10",
  assistant: "border-emerald-400/40 bg-emerald-500/10",
};

export function emptyMessage(role: ChatMessage["role"] = "user"): ChatMessage {
  return { id: newId("msg"), role, content: "" };
}

/** Add / remove / reorder the conversation. Touch targets stay ≥ 36px. */
export function MessageList({ messages, onChange, busy }: MessageListProps) {
  const update = (id: string, patch: Partial<ChatMessage>) =>
    onChange(messages.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const remove = (id: string) => onChange(messages.filter((m) => m.id !== id));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= messages.length) return;
    const next = [...messages];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-[var(--frost-muted)] font-medium">
          Messages ({messages.length})
        </h3>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onChange([...messages, emptyMessage("user")])}
            icon={<Icon name="plus" size={14} />}
          >
            User
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onChange([...messages, emptyMessage("assistant")])}
            icon={<Icon name="plus" size={14} />}
          >
            Assistant
          </Button>
        </div>
      </div>

      {messages.length === 0 ? (
        <p className="glass-card p-4 text-sm text-[var(--frost-muted)]">
          No messages yet. Add a user message to start the conversation.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {messages.map((message, index) => (
          <li
            key={message.id}
            className={cn("rounded-xl border p-2.5", ROLE_TONE[message.role])}
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <Select
                aria-label={`Role for message ${index + 1}`}
                value={message.role}
                disabled={busy}
                onChange={(event) =>
                  update(message.id, { role: event.target.value as ChatMessage["role"] })
                }
                className="!w-auto !py-1.5 text-xs"
              >
                <option value="system">system</option>
                <option value="user">user</option>
                <option value="assistant">assistant</option>
              </Select>
              <span className="flex-1" />
              <Button
                size="icon"
                variant="ghost"
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move message ${index + 1} up`}
                className="!h-9 !w-9 sm:!h-8 sm:!w-8"
              >
                <Icon name="chevronUp" size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy || index === messages.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move message ${index + 1} down`}
                className="!h-9 !w-9 sm:!h-8 sm:!w-8"
              >
                <Icon name="chevronDown" size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={() => remove(message.id)}
                aria-label={`Delete message ${index + 1}`}
                className="!h-9 !w-9 sm:!h-8 sm:!w-8 text-red-300"
              >
                <Icon name="trash" size={14} />
              </Button>
            </div>
            <Textarea
              aria-label={`Content for ${message.role} message ${index + 1}`}
              value={message.content}
              disabled={busy}
              rows={message.role === "system" ? 2 : 3}
              placeholder={
                message.role === "system"
                  ? "You are a terse assistant…"
                  : message.role === "user"
                    ? "Ask something…"
                    : "Prior assistant reply…"
              }
              onChange={(event) => update(message.id, { content: event.target.value })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
