"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

/**
 * Visual-only chat UI for the future "AI trainer" — per explicit
 * instruction ("ahorita pones solamente un chatbot... y no le
 * conectamos todavía con Anthropic, pero la idea sería poder como
 * chatear"): typing and sending works, messages appear in the thread,
 * but there is NO real model behind it yet — no API call is made here,
 * and no reply is fabricated, since this codebase never fakes an AI
 * response it hasn't actually generated (same rule CLAUDE.md applies
 * everywhere else). This is the entry point the roadmap's "virtual
 * coach agent" item (see CLAUDE.md's Roadmap section) will eventually
 * wire up to a real model, reading the athlete's profile/zones once
 * that profile exists (task #27).
 */
export function AiChatPlaceholder() {
  const { locale } = useLocale();
  const isEn = locale === "en";
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      text: isEn
        ? "Hi! I'll be your AI training coach — ask me to help plan or adjust your training once I'm connected. For now this chat isn't wired up to a real model yet, but you can try it out."
        : "¡Hola! Seré tu entrenador de IA — podrás pedirme ayuda para planear o ajustar tu entrenamiento una vez que esté conectado. Por ahora este chat todavía no está conectado a un modelo real, pero puedes probarlo.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: `${Date.now()}`, role: "user", text }]);
    setDraft("");
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    });
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{isEn ? "AI Training Chat" : "Chat de Entrenamiento con IA"}</h3>
        <p className="text-xs text-ink-3">
          {isEn ? "Not connected to a real AI yet — coming soon." : "Todavía no conectado a una IA real — próximamente."}
        </p>
      </div>

      <div ref={listRef} className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-bg p-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-xl bg-ink px-3 py-2 text-sm text-bg"
                : "mr-auto max-w-[85%] rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink"
            }
          >
            {m.text}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isEn ? "Type a message…" : "Escribe un mensaje…"}
          className="h-10 flex-1 rounded-xl border border-line bg-bg px-3 text-sm"
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          {isEn ? "Send" : "Enviar"}
        </Button>
      </form>
    </Card>
  );
}
