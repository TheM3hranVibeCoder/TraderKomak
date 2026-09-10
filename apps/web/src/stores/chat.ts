import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage } from "@traderkomak/shared";
import { ChatClient, type ChatStatus } from "@/services/chatClient";

const NICK_KEY = "tk-chat-nick";
const ADMIN_KEY = "tk-chat-admin";
const OPEN_KEY = "tk-chat-open";

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const online = ref(0);
  const status = ref<ChatStatus>("offline");
  const nick = ref<string>(localStorage.getItem(NICK_KEY) ?? "");
  const isAdmin = ref<boolean>(!!localStorage.getItem(ADMIN_KEY));
  const open = ref<boolean>(localStorage.getItem(OPEN_KEY) === "1");
  const error = ref<string | null>(null);

  let client: ChatClient | null = null;

  function ensureClient(): void {
    if (client) return;
    if (!nick.value) return;
    client = new ChatClient({
      onHistory: (list) => {
        messages.value = list;
      },
      onChat: (msg) => {
        messages.value = [...messages.value, msg];
        if (messages.value.length > 300) messages.value = messages.value.slice(-300);
      },
      onDeleted: (id) => {
        messages.value = messages.value.filter((m) => m.id !== id);
      },
      onSystem: (text, ts) => {
        messages.value = [...messages.value, { id: `s-${ts}-${Math.random().toString(36).slice(2, 6)}`, from: "", text, ts }];
      },
      onOnline: (count) => {
        online.value = count;
      },
      onStatus: (s) => {
        status.value = s;
      },
      onError: (msg) => {
        error.value = msg;
        setTimeout(() => {
          if (error.value === msg) error.value = null;
        }, 4000);
      },
    });
    client.connect(nick.value, localStorage.getItem(ADMIN_KEY) ?? undefined);
  }

  function setNick(value: string): boolean {
    const clean = value.trim().replace(/\s+/g, " ").slice(0, 20);
    if (clean.length < 2) {
      error.value = "Nickname must be at least 2 characters";
      return false;
    }
    nick.value = clean;
    localStorage.setItem(NICK_KEY, clean);
    error.value = null;
    ensureClient();
    return true;
  }

  function setOpen(v: boolean): void {
    open.value = v;
    localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    if (v) ensureClient();
  }

  function sendText(text: string): boolean {
    const clean = text.trim().slice(0, 400);
    if (!clean || !client) return false;
    client.sendText(clean);
    return true;
  }

  function sendImage(dataUrl: string): boolean {
    if (!client) return false;
    client.sendImage(dataUrl);
    return true;
  }

  function deleteMessage(id: string): void {
    client?.deleteMessage(id);
  }

  function leave(): void {
    client?.disconnect();
    client = null;
    status.value = "offline";
  }

  return {
    messages,
    online,
    status,
    nick,
    isAdmin,
    open,
    error,
    ensureClient,
    setNick,
    setOpen,
    sendText,
    sendImage,
    deleteMessage,
    leave,
  };
});
