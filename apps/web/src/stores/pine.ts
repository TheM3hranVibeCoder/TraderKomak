/**
 * Pine Script store — the visitor's own indicator scripts.
 *
 * Scripts live in localStorage (offline cache, quota-safe writes) and sync
 * to the account via cloudSync (user_settings.data.pineScripts). Which
 * scripts sit on the CURRENT symbol's chart is per-symbol (addedMap), like
 * every other indicator. Input values are saved per script so a tweaked
 * length/color survives refreshes.
 *
 * UI state (editor dock open, which script is being edited) also lives
 * here so the toolbar and the chart can drive the editor without prop
 * drilling.
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useMarketStore } from "@/stores/market";

const KEY = "tk-pine-v1";
const MAX_SCRIPTS = 30;
const MAX_CODE_LEN = 120_000;

export interface PineScript {
  id: string;
  name: string;
  code: string;
  createdAt: number;
}

function sanitizeScripts(raw: unknown): PineScript[] {
  if (!Array.isArray(raw)) return [];
  const out: PineScript[] = [];
  for (const s of raw as Array<Record<string, unknown>>) {
    if (typeof s?.id !== "string" || typeof s?.code !== "string") continue;
    out.push({
      id: s.id,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 40) : "Script",
      code: s.code.slice(0, MAX_CODE_LEN),
      createdAt: typeof s.createdAt === "number" ? s.createdAt : 0,
    });
  }
  return out.slice(0, MAX_SCRIPTS);
}

function sanitizeAddedMap(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [sym, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(ids)) continue;
    const clean = ids.filter((x): x is string => typeof x === "string");
    if (clean.length > 0) out[sym] = clean;
  }
  return out;
}

export const usePineStore = defineStore("pine", () => {
  const scripts = ref<PineScript[]>([]);
  /** scriptId → input values (by input title). */
  const inputValues = ref<Record<string, Record<string, number | boolean | string>>>({});
  /** Which scripts are on the CURRENT symbol's chart (per-symbol). */
  const addedMap = ref<Record<string, string[]>>({});
  /** Eye toggle per symbol+script (default visible when absent). */
  const visibleMap = ref<Record<string, Record<string, boolean>>>({});
  /** Editor dock. */
  const editorOpen = ref(false);
  /** null = new script; otherwise the id being edited. */
  const editingId = ref<string | null>(null);

  // Restore
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as {
        scripts?: unknown;
        inputValues?: unknown;
        addedMap?: unknown;
        visibleMap?: unknown;
      };
      scripts.value = sanitizeScripts(p.scripts);
      if (p.visibleMap && typeof p.visibleMap === "object") {
        const cleanVis: Record<string, Record<string, boolean>> = {};
        for (const [sym, m] of Object.entries(p.visibleMap as Record<string, unknown>)) {
          if (!m || typeof m !== "object") continue;
          const ok: Record<string, boolean> = {};
          for (const [id, v] of Object.entries(m as Record<string, unknown>)) {
            if (typeof v === "boolean") ok[id] = v;
          }
          if (Object.keys(ok).length > 0) cleanVis[sym] = ok;
        }
        visibleMap.value = cleanVis;
      }
      if (p.inputValues && typeof p.inputValues === "object") {
        const clean: Record<string, Record<string, number | boolean | string>> = {};
        for (const [id, vals] of Object.entries(p.inputValues as Record<string, unknown>)) {
          if (!vals || typeof vals !== "object") continue;
          const ok: Record<string, number | boolean | string> = {};
          for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
            if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") ok[k] = v;
          }
          if (Object.keys(ok).length > 0) clean[id] = ok;
        }
        inputValues.value = clean;
      }
      addedMap.value = sanitizeAddedMap(p.addedMap);
    }
  } catch {}

  watch(
    [scripts, inputValues, addedMap, visibleMap],
    () => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            scripts: scripts.value,
            inputValues: inputValues.value,
            addedMap: addedMap.value,
            visibleMap: visibleMap.value,
          })
        );
      } catch {}
    },
    { deep: true }
  );

  const market = useMarketStore();

  function addedFor(symbol: string): string[] {
    return addedMap.value[symbol] ?? [];
  }

  function currentAdded(): string[] {
    return addedFor(market.instrument);
  }

  function isAdded(id: string): boolean {
    return currentAdded().includes(id);
  }

  function setAdded(symbol: string, ids: string[]): void {
    const next = { ...addedMap.value };
    if (ids.length > 0) next[symbol] = ids;
    else delete next[symbol];
    addedMap.value = next;
  }

  function toggleAdded(id: string): void {
    const ids = currentAdded();
    setAdded(market.instrument, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  function addToCurrent(id: string): void {
    const ids = currentAdded();
    if (!ids.includes(id)) setAdded(market.instrument, [...ids, id]);
    setVisible(market.instrument, id, true);
  }

  function removeFromCurrent(id: string): void {
    setAdded(market.instrument, currentAdded().filter((x) => x !== id));
  }

  function isVisible(symbol: string, id: string): boolean {
    return visibleMap.value[symbol]?.[id] !== false;
  }

  function setVisible(symbol: string, id: string, on: boolean): void {
    const forSym = { ...(visibleMap.value[symbol] ?? {}) };
    if (on) delete forSym[id];
    else forSym[id] = false;
    const next = { ...visibleMap.value };
    if (Object.keys(forSym).length > 0) next[symbol] = forSym;
    else delete next[symbol];
    visibleMap.value = next;
  }

  /** Cloud-sync restore: merge everything after sanitizing. */
  function applyCloud(scriptsRaw: unknown, inputRaw: unknown, addedRaw: unknown, currentSymbol: string, visibleRaw?: unknown): boolean {
    const incoming = sanitizeScripts(scriptsRaw);
    const merged = mergeScripts(incoming);
    let changed = merged.changed;
    const cleanInputs: Record<string, Record<string, number | boolean | string>> = { ...inputValues.value };
    if (inputRaw && typeof inputRaw === "object") {
      for (const [id, vals] of Object.entries(inputRaw as Record<string, unknown>)) {
        if (!vals || typeof vals !== "object") continue;
        const ok: Record<string, number | boolean | string> = {};
        for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
          if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") ok[k] = v;
        }
        if (Object.keys(ok).length > 0 && JSON.stringify(cleanInputs[id] ?? {}) !== JSON.stringify(ok)) {
          cleanInputs[id] = ok;
          changed = true;
        }
      }
    }
    inputValues.value = cleanInputs;
    // Added flags: union per symbol (cloud may know symbols this device
    // hasn't seen; local additions the cloud lacks are pushed back up).
    const cloudAdded = sanitizeAddedMap(addedRaw);
    const mergedAdded: Record<string, string[]> = {};
    const symbols = new Set([...Object.keys(addedMap.value), ...Object.keys(cloudAdded)]);
    for (const sym of symbols) {
      const union = [...new Set([...(cloudAdded[sym] ?? []), ...(addedMap.value[sym] ?? [])])].filter((id) => merged.scripts.some((s) => s.id === id));
      if (union.length > 0) mergedAdded[sym] = union;
      if (JSON.stringify(union) !== JSON.stringify(addedMap.value[sym] ?? [])) changed = true;
    }
    // The current symbol keeps its LOCAL state (the chart is already set up);
    // cloud wins for other devices' symbols.
    if (addedMap.value[currentSymbol]) mergedAdded[currentSymbol] = addedMap.value[currentSymbol];
    addedMap.value = mergedAdded;
    if (visibleRaw && typeof visibleRaw === "object") {
      const mergedVis: Record<string, Record<string, boolean>> = { ...(visibleRaw as Record<string, Record<string, boolean>>) };
      if (visibleMap.value[currentSymbol]) mergedVis[currentSymbol] = visibleMap.value[currentSymbol];
      visibleMap.value = mergedVis;
    }
    return changed;
  }

  /** Union of cloud scripts with local ones (local wins on same id + newer
   *  content? — deterministic rule: the CLOUD copy wins for identical ids
   *  so all devices converge; scripts existing only locally are kept). */
  function mergeScripts(incoming: PineScript[]): { scripts: PineScript[]; changed: boolean } {
    const byId = new Map<string, PineScript>();
    for (const s of scripts.value) byId.set(s.id, s);
    let changed = false;
    for (const s of incoming) {
      const local = byId.get(s.id);
      if (!local) {
        byId.set(s.id, s);
        changed = true;
      } else if (local.code !== s.code || local.name !== s.name) {
        // Prefer the NEWER edit (createdAt is the original creation; use
        // code length + content compare — cloud apply happens on login and
        // the device pushes its own state right after, so convergence is
        // safe either way).
        byId.set(s.id, s);
        changed = true;
      }
    }
    const list = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, MAX_SCRIPTS);
    scripts.value = list;
    return { scripts: list, changed };
  }

  function snapshotForCloud(): {
    scripts: PineScript[];
    inputValues: Record<string, Record<string, number | boolean | string>>;
    addedMap: Record<string, string[]>;
    visibleMap: Record<string, Record<string, boolean>>;
  } {
    return {
      scripts: scripts.value,
      inputValues: inputValues.value,
      addedMap: addedMap.value,
      visibleMap: visibleMap.value,
    };
  }

  function createScript(name: string, code: string): PineScript {
    const s: PineScript = {
      id: "pine-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim().slice(0, 40) || "Script",
      code: code.slice(0, MAX_CODE_LEN),
      createdAt: Date.now(),
    };
    scripts.value = [...scripts.value, s].slice(0, MAX_SCRIPTS);
    return s;
  }

  function updateScript(id: string, patch: { name?: string; code?: string }): void {
    scripts.value = scripts.value.map((s) =>
      s.id === id
        ? {
            ...s,
            name: patch.name !== undefined ? patch.name.trim().slice(0, 40) || s.name : s.name,
            code: patch.code !== undefined ? patch.code.slice(0, MAX_CODE_LEN) : s.code,
          }
        : s
    );
  }

  function removeScript(id: string): void {
    scripts.value = scripts.value.filter((s) => s.id !== id);
    for (const sym of Object.keys(addedMap.value)) {
      setAdded(sym, (addedMap.value[sym] ?? []).filter((x) => x !== id));
    }
    const vis = { ...visibleMap.value };
    for (const sym of Object.keys(vis)) {
      if (vis[sym] && id in vis[sym]) {
        const { [id]: _drop, ...rest } = vis[sym]!;
        if (Object.keys(rest).length > 0) vis[sym] = rest;
        else delete vis[sym];
      }
    }
    visibleMap.value = vis;
    const inputs = { ...inputValues.value };
    delete inputs[id];
    inputValues.value = inputs;
    if (editingId.value === id) editingId.value = null;
  }

  function setInputValues(id: string, values: Record<string, number | boolean | string>): void {
    inputValues.value = { ...inputValues.value, [id]: values };
  }

  function inputValuesFor(id: string): Record<string, number | boolean | string> {
    return inputValues.value[id] ?? {};
  }

  function openEditor(id: string | null): void {
    editingId.value = id;
    editorOpen.value = true;
  }

  function closeEditor(): void {
    editorOpen.value = false;
    editingId.value = null;
  }

  return {
    scripts,
    inputValues,
    addedMap,
    visibleMap,
    editorOpen,
    editingId,
    currentAdded,
    addedFor,
    isAdded,
    isVisible,
    setVisible,
    toggleAdded,
    addToCurrent,
    removeFromCurrent,
    createScript,
    updateScript,
    removeScript,
    setInputValues,
    inputValuesFor,
    applyCloud,
    snapshotForCloud,
    openEditor,
    closeEditor,
  };
});
