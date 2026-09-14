<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import { useChatStore } from "@/stores/chat";

const chat = useChatStore();
const emit = defineEmits<{ (e: "close"): void }>();

const tab = ref<"users" | "muted" | "banned">("users");

const onlineSet = computed(() => new Set(chat.onlineNicks));
const mutedNicks = computed(() => chat.mutes.map((m) => m.nick));
const bannedNicks = computed(() => chat.bans.map((b) => b.nick));
const mutedSet = computed(() => new Set(mutedNicks.value));
const bannedSet = computed(() => new Set(bannedNicks.value));

/** Everyone the room knows: online first, then the rest by recency. */
const allUsers = computed(() => {
  const seen = new Set<string>();
  const list: { nick: string; online: boolean; lastSeen: number }[] = [];
  for (const n of chat.onlineNicks) {
    seen.add(n.toLowerCase());
    list.push({ nick: n, online: true, lastSeen: 0 });
  }
  for (const k of [...chat.knownNicks].sort((a, b) => b.lastSeen - a.lastSeen)) {
    if (seen.has(k.nick.toLowerCase())) continue;
    seen.add(k.nick.toLowerCase());
    list.push({ nick: k.nick, online: false, lastSeen: k.lastSeen });
  }
  return list;
});

const filter = ref("");
const filteredUsers = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return allUsers.value;
  return allUsers.value.filter((u) => u.nick.toLowerCase().includes(q));
});

function mute(nick: string, minutes: number): void {
  chat.moderate("mute", nick, minutes);
}
function ban(nick: string): void {
  chat.moderate("ban", nick);
}
function unmute(nick: string): void {
  chat.moderate("unmute", nick);
}
function unban(nick: string): void {
  chat.moderate("unban", nick);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") emit("close");
}
window.addEventListener("keydown", onKey);
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div class="admin-backdrop" @click.self="emit('close')">
      <div class="admin-panel" role="dialog" aria-modal="true" aria-label="Admin panel">
        <header class="admin-head">
          <div class="admin-head-text">
            <h2 class="admin-title">Admin Panel</h2>
            <p class="admin-sub">Manage chat users — mute, ban and moderate the room.</p>
          </div>
          <button class="admin-close" type="button" aria-label="Close" @click="emit('close')">✕</button>
        </header>

        <!-- stat chips -->
        <div class="admin-stats">
          <div class="stat green"><span class="stat-num">{{ chat.online }}</span><span class="stat-label">Online</span></div>
          <div class="stat blue"><span class="stat-num">{{ allUsers.length }}</span><span class="stat-label">Known users</span></div>
          <div class="stat amber"><span class="stat-num">{{ chat.mutes.length }}</span><span class="stat-label">Muted</span></div>
          <div class="stat red"><span class="stat-num">{{ chat.bans.length }}</span><span class="stat-label">Banned</span></div>
        </div>

        <div class="admin-tabs" role="tablist">
          <button class="tab" :class="{ on: tab === 'users' }" role="tab" :aria-selected="tab === 'users'" @click="tab = 'users'">Users</button>
          <button class="tab" :class="{ on: tab === 'muted' }" role="tab" :aria-selected="tab === 'muted'" @click="tab = 'muted'">Muted ({{ chat.mutes.length }})</button>
          <button class="tab" :class="{ on: tab === 'banned' }" role="tab" :aria-selected="tab === 'banned'" @click="tab = 'banned'">Banned ({{ chat.bans.length }})</button>
        </div>

        <div v-if="tab === 'users'" class="admin-body">
          <input
            v-model="filter"
            class="admin-search"
            type="text"
            placeholder="Search users…"
            aria-label="Search users"
          />
          <div v-if="!filteredUsers.length" class="admin-empty">No users seen yet.</div>
          <div v-for="u in filteredUsers" :key="u.nick" class="user-row">
            <span class="dot" :class="u.online ? 'on' : 'off'"></span>
            <span class="user-nick">{{ u.nick }}</span>
            <span v-if="bannedSet.has(u.nick.toLowerCase())" class="user-flag banned">banned</span>
            <span v-else-if="mutedSet.has(u.nick.toLowerCase())" class="user-flag muted">muted</span>
            <span v-else-if="u.online" class="user-flag live">online</span>
            <div class="user-actions">
              <button class="act amber" :disabled="bannedSet.has(u.nick.toLowerCase())" @click="mute(u.nick, 10)">Mute 10m</button>
              <button class="act amber dark" :disabled="bannedSet.has(u.nick.toLowerCase())" @click="mute(u.nick, 1440)">Mute 24h</button>
              <button v-if="bannedSet.has(u.nick.toLowerCase())" class="act green" @click="unban(u.nick)">Unban</button>
              <button v-else class="act red" @click="ban(u.nick)">Ban</button>
            </div>
          </div>
        </div>

        <div v-else-if="tab === 'muted'" class="admin-body">
          <div v-if="!chat.mutes.length" class="admin-empty">Nobody is muted.</div>
          <div v-for="m in chat.mutes" :key="m.nick" class="user-row">
            <span class="dot off"></span>
            <span class="user-nick">{{ m.nick }}</span>
            <span class="user-flag muted">muted</span>
            <div class="user-actions">
              <button class="act green" @click="unmute(m.nick)">Unmute</button>
            </div>
          </div>
        </div>

        <div v-else class="admin-body">
          <div v-if="!chat.bans.length" class="admin-empty">Nobody is banned.</div>
          <div v-for="b in chat.bans" :key="b.nick" class="user-row">
            <span class="dot off"></span>
            <span class="user-nick">{{ b.nick }}</span>
            <span class="user-flag banned">banned</span>
            <div class="user-actions">
              <button class="act green" @click="unban(b.nick)">Unban</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.admin-backdrop {
  position: fixed;
  inset: 0;
  z-index: 320;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 18, 45, 0.45);
  backdrop-filter: blur(6px);
}
.admin-panel {
  width: min(520px, calc(100vw - 28px));
  max-height: min(640px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  background: linear-gradient(160deg, #f5f8ff 0%, #eef2ff 50%, #f7f0ff 100%);
  box-shadow: 0 24px 70px rgba(25, 20, 70, 0.35);
  overflow: hidden;
  color: #23283a;
}
.admin-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px 14px;
  background: linear-gradient(120deg, #f472b6 0%, #a78bfa 35%, #60a5fa 75%, #34d399 120%);
  color: #fff;
}
.admin-head-text { flex: 1; min-width: 0; }
.admin-title { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: 0.2px; }
.admin-sub { margin: 2px 0 0; font-size: 11.5px; opacity: 0.9; }
.admin-close {
  width: 30px; height: 30px;
  border: none;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.admin-close:hover { background: rgba(255, 255, 255, 0.4); }

.admin-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 14px 20px 4px;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 4px;
  border-radius: 14px;
  color: #fff;
}
.stat.green  { background: linear-gradient(135deg, #34d399, #10b981); }
.stat.blue   { background: linear-gradient(135deg, #60a5fa, #3b82f6); }
.stat.amber  { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.stat.red    { background: linear-gradient(135deg, #fb7185, #ef4444); }
.stat-num { font-size: 19px; font-weight: 800; line-height: 1.1; }
.stat-label { font-size: 10px; font-weight: 600; opacity: 0.92; text-transform: uppercase; letter-spacing: 0.4px; }

.admin-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 20px 10px;
}
.tab {
  padding: 7px 14px;
  border: none;
  border-radius: 999px;
  background: rgba(100, 116, 160, 0.12);
  color: #55607e;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.tab:hover { background: rgba(100, 116, 160, 0.2); }
.tab.on {
  background: linear-gradient(120deg, #8b5cf6, #6366f1, #3b82f6);
  color: #fff;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
}

.admin-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 20px 18px;
}
.admin-search {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 10px;
  padding: 9px 13px;
  border: 1px solid rgba(100, 116, 160, 0.25);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.8);
  color: #23283a;
  font-size: 13px;
}
.admin-search:focus { outline: none; border-color: #8b5cf6; }
.admin-empty {
  padding: 26px 0;
  text-align: center;
  font-size: 12.5px;
  color: #7a83a0;
}
.user-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  margin-bottom: 7px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 2px 8px rgba(60, 60, 130, 0.07);
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.on { background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.7); }
.dot.off { background: #b6bdd1; }
.user-nick {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-flag {
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2.5px 7px;
  border-radius: 999px;
  color: #fff;
}
.user-flag.live { background: linear-gradient(135deg, #34d399, #10b981); }
.user-flag.muted { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.user-flag.banned { background: linear-gradient(135deg, #fb7185, #ef4444); }
.user-actions { display: flex; gap: 6px; }
.act {
  padding: 5.5px 11px;
  border: none;
  border-radius: 9px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
}
.act:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.08); }
.act:disabled { opacity: 0.4; cursor: default; }
.act.amber { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.act.amber.dark { background: linear-gradient(135deg, #f59e0b, #ea7c1c); }
.act.red { background: linear-gradient(135deg, #fb7185, #ef4444); }
.act.green { background: linear-gradient(135deg, #34d399, #10b981); }
</style>
