<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import { useChatStore } from "@/stores/chat";
import { supabase } from "@/services/supabase";
import { compressImage } from "@/utils/image";

const chat = useChatStore();
const emit = defineEmits<{ (e: "close"): void }>();

function close(): void {
  chat.clearTgFlags();
  chat.clearDmStatuses();
  emit("close");
}

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

/* ── Custom mute: amount + unit ── */
const muteAmount = ref(10);
const muteUnit = ref<"minutes" | "hours" | "days">("minutes");
const muteMinutes = computed(() => {
  const n = Math.max(1, Math.floor(muteAmount.value) || 0);
  return muteUnit.value === "minutes" ? n : muteUnit.value === "hours" ? n * 60 : n * 1440;
});
function mute(nick: string): void {
  chat.moderate("mute", nick, muteMinutes.value);
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
function isSelf(nick: string): boolean {
  return nick.toLowerCase() === chat.nick.toLowerCase();
}

/* ── User details modal (email / IP / country) ── */
const details = ref<null | { nick: string; email: string | null; loading: boolean }>(null);
async function openDetails(nick: string): Promise<void> {
  details.value = { nick, email: null, loading: true };
  chat.askUserInfo(nick);
  try {
    const { data: p } = await supabase()
      .from("profiles")
      .select("user_id")
      .eq("username_lower", nick.toLowerCase())
      .maybeSingle();
    if (p) {
      const uid = p.user_id as string;
      // 1) Live lookup straight from the auth table (admin-only RPC —
      //    works even if the user never logged in since the email sync
      //    existed). Falls back to the synced user_emails row.
      let email: string | null = null;
      const { data: rpcMail, error: rpcErr } = await supabase()
        .rpc("admin_user_email", { uid });
      if (!rpcErr && typeof rpcMail === "string" && rpcMail) {
        email = rpcMail;
      } else if (rpcErr && (rpcErr as { code?: string }).code !== "404" && (rpcErr as { code?: string }).code !== "42883" && (rpcErr as { code?: string }).code !== "PGRST202") {
        console.warn("admin_user_email rpc unavailable — falling back to user_emails");
      }
      if (!email) {
        const { data: e } = await supabase()
          .from("user_emails")
          .select("email")
          .eq("user_id", uid)
          .maybeSingle();
        email = (e?.email as string) ?? null;
      }
      if (details.value && details.value.nick === nick) details.value.email = email;
    }
  } catch {}
  if (details.value) details.value.loading = false;
}

/* ── Direct message composer ── */
const dmTarget = ref<string | null>(null);
const dmText = ref("");
const dmImg = ref<string | null>(null);
const dmFileEl = ref<HTMLInputElement | null>(null);
const dmSending = ref(false);

async function stageDmImage(file: File): Promise<void> {
  try {
    dmImg.value = await compressImage(file);
  } catch {
    /* ignore unreadable images */
  }
}
function onDmFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) void stageDmImage(f);
  input.value = "";
}
function onDmPaste(e: ClipboardEvent): void {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (file) {
    e.preventDefault();
    void stageDmImage(file);
  }
}
function openDm(nick: string): void {
  dmTarget.value = nick;
  dmText.value = "";
}
/** Broadcast: same popup to every online user; per-row Read chips show
 *  who acknowledged (the dmStatusFor chips already track each send). */
function dmAllCount(): number {
  return chat.onlineNicks.filter((n) => !isSelf(n)).length;
}
function sendDm(): void {
  const t = dmText.value.trim();
  if ((!t && !dmImg.value) || !dmTarget.value) return;
  dmSending.value = true;
  if (dmTarget.value === "__all__") {
    for (const n of chat.onlineNicks) {
      if (!isSelf(n)) chat.adminDm(n, t, dmImg.value ?? undefined);
    }
  } else {
    chat.adminDm(dmTarget.value, t, dmImg.value ?? undefined);
  }
  dmSending.value = false;
  dmTarget.value = null;
  dmText.value = "";
  dmImg.value = null;
}
function dmStatusFor(nick: string): string | null {
  const entries = Object.values(chat.dmStatuses).filter((s) => s.nick.toLowerCase() === nick.toLowerCase());
  if (!entries.length) return null;
  const last = entries[entries.length - 1]!;
  return last.offline ? "offline" : last.read ? "Read ✓" : "Sent…";
}

/* ── Telegram broadcast ── */
const tgSent = ref(false);
function tgBroadcast(): void {
  chat.tgBroadcast();
  tgSent.value = true;
  setTimeout(() => (tgSent.value = false), 3000);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    if (details.value) details.value = null;
    else if (dmTarget.value) dmTarget.value = null;
    else close();
  }
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
            <p class="admin-sub">Manage chat users — mute, ban, message and announce.</p>
          </div>
          <button class="admin-close" type="button" aria-label="Close" @click="close">✕</button>
        </header>

        <!-- stat chips + telegram broadcast -->
        <div class="admin-stats">
          <div class="stat green"><span class="stat-num">{{ chat.online }}</span><span class="stat-label">Online</span></div>
          <div class="stat blue"><span class="stat-num">{{ allUsers.length }}</span><span class="stat-label">Known users</span></div>
          <div class="stat amber"><span class="stat-num">{{ chat.mutes.length }}</span><span class="stat-label">Muted</span></div>
          <div class="stat red"><span class="stat-num">{{ chat.bans.length }}</span><span class="stat-label">Banned</span></div>
        </div>
        <div class="tg-row">
          <button class="dm-all" type="button" :title="`Send a direct message to all ${dmAllCount()} online users`" @click="openDm('__all__')">DM all · {{ dmAllCount() }}</button>
          <button class="tg-broadcast" type="button" title="Show a Join-Telegram popup to every online user" @click="tgBroadcast">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
            {{ tgSent ? "Sent ✓" : "Telegram" }}
          </button>
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
            <button class="nick-btn" type="button" title="Show details (email, IP, country)" @click="openDetails(u.nick)">
              <span class="dot" :class="u.online ? 'on' : 'off'"></span>
              <span class="user-nick">{{ u.nick }}</span>
            </button>
            <span v-if="isSelf(u.nick)" class="user-flag you">you</span>
            <template v-else>
              <span v-if="bannedSet.has(u.nick.toLowerCase())" class="user-flag banned">banned</span>
              <span v-else-if="mutedSet.has(u.nick.toLowerCase())" class="user-flag muted">muted</span>
              <span v-else-if="u.online" class="user-flag live">online</span>
              <span v-if="chat.tgFlags[u.nick]" class="tg-flag" :class="chat.tgFlags[u.nick]">{{ chat.tgFlags[u.nick] === "join" ? "TG joined ✓" : "TG closed ✕" }}</span>
              <span v-if="dmStatusFor(u.nick)" class="dm-status">{{ dmStatusFor(u.nick) }}</span>
              <div class="user-actions">
                <button class="act blue" title="Send a direct message" @click="openDm(u.nick)">DM</button>
                <input
                  v-model="muteAmount"
                  class="mute-amount"
                  type="number"
                  min="1"
                  max="365"
                  aria-label="Mute duration"
                />
                <select v-model="muteUnit" class="mute-unit" aria-label="Mute unit">
                  <option value="minutes">min</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                <button class="act amber" :disabled="bannedSet.has(u.nick.toLowerCase())" @click="mute(u.nick)">Mute</button>
                <button v-if="bannedSet.has(u.nick.toLowerCase())" class="act green" @click="unban(u.nick)">Unban</button>
                <button v-else class="act red" @click="ban(u.nick)">Ban</button>
              </div>
            </template>
          </div>
        </div>

        <div v-else-if="tab === 'muted'" class="admin-body">
          <div v-if="!chat.mutes.length" class="admin-empty">Nobody is muted.</div>
          <div v-for="m in chat.mutes" :key="m.nick" class="user-row">
            <button class="nick-btn" type="button" @click="openDetails(m.nick)">
              <span class="dot off"></span>
              <span class="user-nick">{{ m.nick }}</span>
            </button>
            <span class="user-flag muted">muted</span>
            <div class="user-actions">
              <button class="act green" @click="unmute(m.nick)">Unmute</button>
            </div>
          </div>
        </div>

        <div v-else class="admin-body">
          <div v-if="!chat.bans.length" class="admin-empty">Nobody is banned.</div>
          <div v-for="b in chat.bans" :key="b.nick" class="user-row">
            <button class="nick-btn" type="button" @click="openDetails(b.nick)">
              <span class="dot off"></span>
              <span class="user-nick">{{ b.nick }}</span>
            </button>
            <span class="user-flag banned">banned</span>
            <div class="user-actions">
              <button class="act green" @click="unban(b.nick)">Unban</button>
            </div>
          </div>
        </div>
      </div>

      <!-- User details modal -->
      <Teleport to="body">
        <div v-if="details" class="mini-backdrop" @click.self="details = null">
          <div class="mini-modal" role="dialog" aria-modal="true" :aria-label="`Details for ${details.nick}`">
            <div class="mini-head">
              <span class="mini-title">{{ details.nick }}</span>
              <button class="mini-x" type="button" aria-label="Close" @click="details = null">✕</button>
            </div>
            <div class="detail-grid">
              <div class="d-row"><span class="d-label">Email</span><span class="d-value">{{ details.loading ? "…" : details.email ?? "not synced yet — opens after their next login" }}</span></div>
              <div class="d-row"><span class="d-label">Status</span><span class="d-value">{{ chat.userInfo?.nick.toLowerCase() === details.nick.toLowerCase() ? (chat.userInfo.online ? "online" : "offline") : "…" }}</span></div>
              <div class="d-row"><span class="d-label">Last IP</span><span class="d-value mono">{{ chat.userInfo?.nick.toLowerCase() === details.nick.toLowerCase() ? chat.userInfo.lastIp ?? "unknown" : "…" }}</span></div>
              <div class="d-row"><span class="d-label">Country</span><span class="d-value">{{ chat.userInfo?.nick.toLowerCase() === details.nick.toLowerCase() ? chat.userInfo.country ?? "unknown" : "…" }}</span></div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- DM composer modal -->
      <Teleport to="body">
        <div v-if="dmTarget" class="mini-backdrop" @click.self="dmTarget = null">
          <div class="mini-modal" role="dialog" aria-modal="true" :aria-label="`Message ${dmTarget}`">
            <div class="mini-head">
              <span class="mini-title">
                <template v-if="dmTarget === '__all__'">Message to <b>ALL online users ({{ dmAllCount() }})</b></template>
                <template v-else>Message to <b>{{ dmTarget }}</b></template>
              </span>
              <button class="mini-x" type="button" aria-label="Close" @click="dmTarget = null">✕</button>
            </div>
            <div v-if="dmImg" class="dm-pending">
              <img :src="dmImg" alt="attached" />
              <button class="dm-pending-x" type="button" aria-label="Remove image" @click="dmImg = null">✕</button>
            </div>
            <textarea
              v-model="dmText"
              class="dm-text"
              rows="3"
              maxlength="500"
              placeholder="They will see this as a popup in the middle of their screen… (optional caption)"
              aria-label="Direct message text"
              @paste="onDmPaste"
            ></textarea>
            <div class="dm-send-row">
              <button class="dm-attach" type="button" title="Attach a photo" aria-label="Attach photo" @click="dmFileEl?.click()">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="M5 17l4.5-4.5 3 3L17 11l4 4.5" />
                </svg>
              </button>
              <button class="dm-send" type="button" :disabled="(!dmText.trim() && !dmImg) || dmSending" @click="sendDm">Send message</button>
            </div>
            <input ref="dmFileEl" type="file" accept="image/*" class="dm-file-hidden" @change="onDmFileChange" />
          </div>
        </div>
      </Teleport>
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
  width: min(560px, calc(100vw - 28px));
  max-height: min(660px, calc(100vh - 40px));
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
  grid-template-columns: repeat(4, 1fr) auto;
  gap: 10px;
  padding: 14px 20px 4px;
  align-items: stretch;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px 4px;
  border-radius: 14px;
  color: #fff;
}
.stat-label { max-width: 100%; }
.stat.green  { background: linear-gradient(135deg, #34d399, #10b981); }
.stat.blue   { background: linear-gradient(135deg, #60a5fa, #3b82f6); }
.stat.amber  { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.stat.red    { background: linear-gradient(135deg, #fb7185, #ef4444); }
.stat-num { font-size: 19px; font-weight: 800; line-height: 1.1; }
.stat-label { font-size: 10px; font-weight: 600; opacity: 0.92; text-transform: uppercase; letter-spacing: 0.4px; }
.dm-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 11px;
  height: 30px;
  align-self: center;
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  background: linear-gradient(135deg, #a78bfa, #6366f1);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
  transition: transform 0.12s ease, filter 0.12s ease;
  white-space: nowrap;
}
.dm-all:hover { transform: translateY(-1px); filter: brightness(1.08); }
.dm-pending {
  position: relative;
  padding: 8px 10px;
  background: rgba(100, 116, 160, 0.08);
}
.dm-pending img {
  display: block;
  max-height: 120px;
  border-radius: 8px;
}
.dm-pending-x {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.9);
  color: #fff;
  cursor: pointer;
}
.dm-send-row { display: flex; align-items: stretch; }
.dm-attach {
  width: 44px;
  border: none;
  background: rgba(100, 116, 160, 0.15);
  color: #55607e;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.dm-attach:hover { background: rgba(100, 116, 160, 0.25); }
.dm-file-hidden { display: none; }
.tg-broadcast {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 11px;
  height: 30px;
  align-self: center;
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  background: linear-gradient(135deg, #38bdf8, #2aabee);
  box-shadow: 0 4px 14px rgba(42, 171, 238, 0.4);
  transition: transform 0.12s ease, filter 0.12s ease;
  white-space: nowrap;
}
.tg-broadcast:hover { transform: translateY(-1px); filter: brightness(1.08); }

.tg-row {
  display: flex;
  padding: 10px 20px 0;
}
.tg-flag {
  font-size: 10px;
  font-weight: 800;
  padding: 2.5px 8px;
  border-radius: 999px;
  color: #fff;
  white-space: nowrap;
}
.tg-flag.join { background: linear-gradient(135deg, #34d399, #10b981); }
.tg-flag.close { background: linear-gradient(135deg, #94a3b8, #64748b); }

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
  min-height: 380px;
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
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 7px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 2px 8px rgba(60, 60, 130, 0.07);
  flex-wrap: wrap;
}
.nick-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 8px;
  min-width: 0;
}
.nick-btn:hover .user-nick { color: #6366f1; text-decoration: underline; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.on { background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.7); }
.dot.off { background: #b6bdd1; }
.user-nick {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
  color: #23283a;
  transition: color 0.12s ease;
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
.user-flag.you { background: linear-gradient(135deg, #8b5cf6, #6366f1); }
.dm-status {
  font-size: 10px;
  font-weight: 800;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.12);
  padding: 2.5px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.user-actions { display: flex; align-items: center; gap: 5px; margin-left: auto; }
.mute-amount {
  width: 52px;
  padding: 5.5px 6px;
  border: 1px solid rgba(100, 116, 160, 0.3);
  border-radius: 9px;
  font-size: 11.5px;
  font-weight: 700;
  color: #23283a;
  background: #fff;
  text-align: center;
}
.mute-amount:focus { outline: none; border-color: #f59e0b; }
.mute-unit {
  padding: 5.5px 4px;
  border: 1px solid rgba(100, 116, 160, 0.3);
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  color: #23283a;
  background: #fff;
  cursor: pointer;
}
.act {
  padding: 5.5px 11px;
  border: none;
  border-radius: 9px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
  white-space: nowrap;
}
.act:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.08); }
.act:disabled { opacity: 0.4; cursor: default; }
.act.amber { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.act.red { background: linear-gradient(135deg, #fb7185, #ef4444); }
.act.green { background: linear-gradient(135deg, #34d399, #10b981); }
.act.blue { background: linear-gradient(135deg, #60a5fa, #3b82f6); }

/* mini modals (details + DM) */
.mini-backdrop {
  position: fixed;
  inset: 0;
  z-index: 340;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 18, 45, 0.5);
}
.mini-modal {
  width: min(380px, calc(100vw - 32px));
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(25, 20, 70, 0.45);
  overflow: hidden;
}
.mini-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  background: linear-gradient(120deg, #8b5cf6, #6366f1, #3b82f6);
  color: #fff;
  font-size: 13.5px;
  font-weight: 800;
}
.mini-title b { font-weight: 900; }
.mini-x {
  border: none;
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  cursor: pointer;
}
.mini-x:hover { background: rgba(255, 255, 255, 0.4); }
.detail-grid { padding: 8px 16px 16px; }
.d-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(100, 116, 160, 0.12);
  font-size: 12.5px;
}
.d-row:last-child { border-bottom: none; }
.d-label { color: #7a83a0; font-weight: 700; }
.d-value { font-weight: 700; color: #23283a; word-break: break-all; text-align: right; }
.d-value.mono { font-family: ui-monospace, monospace; font-size: 12px; }
.dm-text {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 11px 14px;
  border: 1px solid rgba(100, 116, 160, 0.3);
  border-right: none;
  border-radius: 0;
  font-size: 13px;
  font-family: inherit;
  color: #23283a;
  resize: vertical;
  min-height: 96px;
}
.dm-text:focus { outline: none; border-color: #6366f1; }
.dm-send {
  display: block;
  flex: 1;
  padding: 12px;
  border: none;
  background: linear-gradient(120deg, #8b5cf6, #6366f1, #3b82f6);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.dm-send:disabled { opacity: 0.45; cursor: default; }

@media (max-width: 560px) {
  .admin-stats { grid-template-columns: repeat(2, 1fr); }
  .dm-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 11px;
  height: 30px;
  align-self: center;
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  background: linear-gradient(135deg, #a78bfa, #6366f1);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
  transition: transform 0.12s ease, filter 0.12s ease;
  white-space: nowrap;
}
.dm-all:hover { transform: translateY(-1px); filter: brightness(1.08); }
.dm-pending {
  position: relative;
  padding: 8px 10px;
  background: rgba(100, 116, 160, 0.08);
}
.dm-pending img {
  display: block;
  max-height: 120px;
  border-radius: 8px;
}
.dm-pending-x {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.9);
  color: #fff;
  cursor: pointer;
}
.dm-send-row { display: flex; align-items: stretch; }
.dm-attach {
  width: 44px;
  border: none;
  background: rgba(100, 116, 160, 0.15);
  color: #55607e;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.dm-attach:hover { background: rgba(100, 116, 160, 0.25); }
.dm-file-hidden { display: none; }
.tg-broadcast { grid-column: 1 / -1; padding: 10px; }
  .admin-tabs { flex-wrap: wrap; }
  .user-actions { width: 100%; justify-content: flex-start; }
}
</style>
