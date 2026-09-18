/**
 * Deployment freshness check.
 *
 * A long-lived SPA tab keeps running whatever bundle it loaded — after a
 * Vercel deploy, "old" tabs keep old code until manually reloaded (the
 * root of several "it still happens on my phone/PC" reports). On focus /
 * tab return, fetch "/" (tiny, no-store) and compare the deployed bundle
 * hash with the one this tab is running; if a NEWER deployment exists,
 * reload once. Focus-time reloads are the least disruptive moment.
 */

const CHECK_THROTTLE_MS = 30_000;
const RELOAD_GUARD_MS = 30_000;
let lastCheck = 0;
let currentScript = "";

function findBundleRef(html: string): string | null {
  const m = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html);
  return m ? m[0] : null;
}

async function check(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const now = Date.now();
  if (now - lastCheck < CHECK_THROTTLE_MS) return;
  lastCheck = now;
  try {
    const res = await fetch(window.location.origin + "/", { cache: "no-store" });
    if (!res.ok) return;
    const latest = findBundleRef(await res.text());
    if (!latest || !currentScript || currentScript.includes(latest)) return;
    // A different deployment is live — reload once (guard against loops)
    const lastReload = Number(sessionStorage.getItem("tk-ver-reload")) || 0;
    if (Date.now() - lastReload < RELOAD_GUARD_MS) return;
    sessionStorage.setItem("tk-ver-reload", String(Date.now()));
    console.info("[app] new deployment detected — reloading");
    window.location.reload();
  } catch {
    // offline / transient — retry on the next focus
  }
}

export function startVersionCheck(): void {
  const scripts = [...document.querySelectorAll("script[src]")];
  currentScript = scripts
    .map((s) => s.getAttribute("src") ?? "")
    .find((src) => src.includes("index-")) ?? "";
  if (!currentScript) return;
  window.addEventListener("focus", () => void check());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  setInterval(() => void check(), 5 * 60_000);
}
