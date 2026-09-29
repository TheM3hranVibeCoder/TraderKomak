/**
 * Supabase Realtime presence — "who has the site open right now".
 *
 * The chat WebSocket roster only exists while the market server runs, so on
 * the deployed site (no server) the admin panel would otherwise show nobody.
 * Presence is the server-less half of the member list: every signed-in
 * client tracks itself on a shared channel and the admin's client reads the
 * aggregate state. No schema change, no extra service, no market server.
 *
 * Privacy: the channel is as public as the anon key. The tracked payload is
 * only { username }, and usernames are already world-readable via the
 * profiles table (the app fetches them all to validate chat nicks).
 */
import { ref } from "vue";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, supabaseReady } from "@/services/supabase";

/** user_id → username of every signed-in client with the site open now. */
export const onlineMembers = ref<Map<string, string>>(new Map());

const CHANNEL = "tk-presence";

let channel: RealtimeChannel | null = null;
let trackingFor: string | null = null;

/** Idempotent — safe to call on every auth/session change. */
export function startMemberPresence(userId: string, username: string): void {
  if (!supabaseReady || !userId) return;
  if (channel && trackingFor === userId) return; // already on air
  stopMemberPresence();
  trackingFor = userId;
  channel = supabase().channel(CHANNEL, { config: { presence: { key: userId } } });
  channel.on("presence", { event: "sync" }, () => collect());
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") void channel?.track({ username });
  });
}

function collect(): void {
  const next = new Map<string, string>();
  const state = channel?.presenceState() ?? {};
  for (const [key, metas] of Object.entries(state)) {
    const first = metas[0] as { username?: unknown } | undefined;
    if (typeof first?.username === "string" && first.username) next.set(key, first.username);
  }
  onlineMembers.value = next;
}

/** Leaves the channel (sign-out / account switch) and clears the read map. */
export function stopMemberPresence(): void {
  const ch = channel;
  channel = null;
  trackingFor = null;
  onlineMembers.value = new Map();
  if (ch) {
    try {
      void supabase().removeChannel(ch);
    } catch {}
  }
}
