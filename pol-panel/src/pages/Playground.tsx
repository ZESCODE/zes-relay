import { Shell } from "@/components/layout/Shell";
import { ChatPanel } from "@/components/chat/ChatPanel";

export function Playground() {
  return (
    <Shell title="Playground" subtitle="Chat with an enabled model through the relay">
      <ChatPanel />
    </Shell>
  );
}
