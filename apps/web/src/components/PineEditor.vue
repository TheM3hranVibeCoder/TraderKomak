<script setup lang="ts">
/**
 * Pine Editor — a TradingView-style bottom dock for the visitor's own
 * indicator scripts.
 *
 * Left: a lightweight code editor (textarea + tokenized highlight overlay +
 * line-number gutter, zero dependencies). Right: the script's declared
 * inputs (input.int/float/bool/color/source/string) with live values that
 * re-run the indicator on the chart immediately once saved.
 *
 * Compiles on every keystroke (debounced) so errors surface with the line
 * number while typing; "Add to chart" saves into the pine store, which the
 * chart watches.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { usePineStore } from "@/stores/pine";
import { compile, type PineCompileError, type PineInputDecl } from "@/pine";

const pine = usePineStore();

const name = ref("");
const code = ref("");
const error = ref<PineCompileError | null>(null);
const savedFlash = ref(false);
const inputsPanelOpen = ref(true);

watch(
  () => pine.editingId,
  (id) => {
    const s = id ? pine.scripts.find((x) => x.id === id) ?? null : null;
    name.value = s ? s.name : "";
    code.value = s ? s.code : "";
    error.value = null;
    savedFlash.value = false;
    nextTick(() => ta.value?.focus());
  },
  { immediate: true }
);

// Compile as the user types (debounced) — errors inline, inputs live.
let compileTimer: ReturnType<typeof setTimeout> | null = null;
const compiledInputs = ref<PineInputDecl[]>([]);
watch(code, () => {
  if (compileTimer) clearTimeout(compileTimer);
  compileTimer = setTimeout(() => {
    if (!code.value.trim()) {
      error.value = null;
      compiledInputs.value = [];
      return;
    }
    const res = compile(code.value);
    if (res.ok) {
      error.value = null;
      compiledInputs.value = res.script.inputs;
      // Seed unsaved-input titles with their defaults
      for (const inp of res.script.inputs) {
        if (localInputs.value[inp.title] === undefined && inp.def !== undefined) {
          localInputs.value = { ...localInputs.value, [inp.title]: inp.def };
        }
      }
    } else {
      error.value = res.error;
    }
  }, 250);
});

/** Input values while editing: the saved script's stored values, or local
 *  ones for a brand-new script. */
const localInputs = ref<Record<string, number | boolean | string>>({});
const inputValues = computed<Record<string, number | boolean | string>>({
  get: () => (pine.editingId ? pine.inputValuesFor(pine.editingId) : localInputs.value),
  set: (v) => {
    if (pine.editingId) pine.setInputValues(pine.editingId, v);
    else localInputs.value = v;
  },
});

function setInput(title: string, value: number | boolean | string): void {
  inputValues.value = { ...inputValues.value, [title]: value };
}

function save(): void {
  const trimmedName = name.value.trim() || derivedTitle();
  if (pine.editingId) {
    pine.updateScript(pine.editingId, { name: trimmedName, code: code.value });
    pine.addToCurrent(pine.editingId);
  } else {
    const s = pine.createScript(trimmedName, code.value);
    pine.setInputValues(s.id, { ...localInputs.value });
    pine.addToCurrent(s.id);
    pine.editingId = s.id;
  }
  savedFlash.value = true;
  setTimeout(() => (savedFlash.value = false), 1600);
}

/** Fall back to the script's own indicator("…") title. */
function derivedTitle(): string {
  const m = code.value.match(/indicator\(\s*"([^"]+)"/);
  return m?.[1] ?? "Script";
}

// ── editor mechanics ────────────────────────────────────────────────────────

const ta = ref<HTMLTextAreaElement | null>(null);
const scrollTop = ref(0);
const scrollLeft = ref(0);
const lineCount = computed(() => code.value.split("\n").length);

function syncScroll(): void {
  if (!ta.value) return;
  scrollTop.value = ta.value.scrollTop;
  scrollLeft.value = ta.value.scrollLeft;
}

function insertText(text: string): void {
  const el = ta.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const next = code.value.slice(0, start) + text + code.value.slice(end);
  code.value = next;
  nextTick(() => {
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  });
}

function onTab(): void {
  insertText("    ");
}

/** Enter: keep the current line's indent (Pine blocks are indented). */
function onEnter(ev: KeyboardEvent): void {
  const el = ta.value;
  if (!el) return;
  const pos = el.selectionStart;
  const before = code.value.slice(0, pos);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);
  const indent = (currentLine.match(/^[ \t]*/) ?? [""])[0] ?? "";
  // Open block (if/for/=>) → one level deeper
  const opensBlock = /\b(if|for|else)[^\n]*$|\=>$/.test(currentLine.trimEnd());
  insertText("\n" + indent + (opensBlock ? "    " : ""));
  ev.preventDefault();
}

function gotoLine(line: number): void {
  const el = ta.value;
  if (!el) return;
  const lines = code.value.split("\n");
  let pos = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i]!.length + 1;
  el.focus();
  el.selectionStart = pos;
  el.selectionEnd = pos + (lines[line - 1]?.length ?? 0);
  const lh = 19;
  el.scrollTop = Math.max(0, (line - 3) * lh);
  syncScroll();
}

// ── highlighting ────────────────────────────────────────────────────────────

const KW = /\b(indicator|var|varip|if|else|for|to|by|and|or|not|true|false|na|break|continue|input|plot|hline|simple|series|const)\b/;
const NS = /\b(ta|math|color|str|barstate|syminfo)\./;
function highlight(src: string): string {
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const kw = new Set(["indicator", "var", "varip", "if", "else", "for", "to", "by", "and", "or", "not", "true", "false", "na", "break", "continue", "input", "plot", "hline", "simple", "series", "const"]);
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    // comment
    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      const stop = end === -1 ? rest.length : end;
      out.push(`<span class="tok-comment">${esc(rest.slice(0, stop))}</span>`);
      i += stop;
      continue;
    }
    // string
    if (rest[0] === '"' || rest[0] === "'") {
      const q = rest[0]!;
      let j = 1;
      while (j < rest.length && rest[j] !== q) {
        if (rest[j] === "\\") j++;
        j++;
      }
      out.push(`<span class="tok-string">${esc(rest.slice(0, j + 1))}</span>`);
      i += j + 1;
      continue;
    }
    // color literal
    const colorM = rest.match(/^#[0-9a-fA-F]{3,8}\b/);
    if (colorM) {
      out.push(`<span class="tok-color">${esc(colorM[0])}</span>`);
      i += colorM[0].length;
      continue;
    }
    // number
    const numM = rest.match(/^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/);
    if (numM && /^[0-9]/.test(rest)) {
      out.push(`<span class="tok-number">${esc(numM[0])}</span>`);
      i += numM[0].length;
      continue;
    }
    // identifier / dotted builtin
    const idM = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (idM) {
      const word = idM[0];
      let cls = "";
      if (kw.has(word)) cls = "tok-kw";
      else if (/^(ta|math|color|str|barstate|syminfo)\./.test(word)) cls = "tok-ns";
      out.push(cls ? `<span class="${cls}">${esc(word)}</span>` : esc(word));
      i += word.length;
      continue;
    }
    out.push(esc(rest[0]!));
    i += 1;
  }
  return out.join("");
}

const highlighted = computed(() => highlight(code.value) + "\n");

// ── examples ────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE = `//@version=5
indicator("My indicator", overlay=false)

length = input.int(14, title="RSI Length")

r = ta.rsi(close, length)
spread = ta.sma(close, 9) - ta.sma(close, 21)

plot(r, title="RSI", color=color.purple, linewidth=2)
plot(spread, title="MA spread", color=color.orange, style=plot.style_histogram)
hline(70, color=color.red, linestyle=hline.style_dashed)
hline(30, color=color.green, linestyle=hline.style_dashed)
`;

function insertExample(): void {
  code.value = DEFAULT_TEMPLATE;
  name.value = name.value || "My indicator";
  nextTick(() => ta.value?.focus());
}

/* ── right-click menu: copy / cut / paste / select all ────────────────────
 * The chart pane swallows the native context menu, so the editor provides
 * its own. Paste uses the async clipboard API (localhost/HTTPS = secure
 * context); if the browser denies read access, the hint points at Ctrl+V,
 * which always works in a real textarea. */
const menu = ref<{ x: number; y: number; hasSel: boolean } | null>(null);
const canPaste = ref(false);
const pasteHint = ref(false);
let pasteHintTimer: ReturnType<typeof setTimeout> | null = null;

function refreshMenuAnchors(): void {
  const el = ta.value;
  menu.value = el ? { x: menu.value!.x, y: menu.value!.y, hasSel: el.selectionStart !== el.selectionEnd } : menu.value;
}

function onContextMenu(ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  const x = Math.max(4, Math.min(ev.clientX, window.innerWidth - 190));
  const y = Math.max(4, Math.min(ev.clientY, window.innerHeight - 150));
  const el = ta.value;
  menu.value = { x, y, hasSel: !!el && el.selectionStart !== el.selectionEnd };
}

function closeMenu(): void {
  menu.value = null;
  pasteHint.value = false;
}

function selText(): string {
  const el = ta.value;
  if (!el) return "";
  return code.value.slice(el.selectionStart, el.selectionEnd);
}

function replaceSelection(text: string): void {
  const el = ta.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  code.value = code.value.slice(0, start) + text + code.value.slice(end);
  nextTick(() => {
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  });
}

async function menuCopy(): Promise<void> {
  const t = selText();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    legacyCopy(false);
  }
  closeMenu();
}

async function menuCut(): Promise<void> {
  const t = selText();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    legacyCopy(true);
  }
  replaceSelection("");
  closeMenu();
}

/** execCommand fallback when the async clipboard API is unavailable. */
function legacyCopy(withDelete: boolean): void {
  const el = ta.value;
  if (!el) return;
  el.focus();
  el.select();
  const s = el.selectionStart;
  el.setSelectionRange(s, s + selText().length);
  try {
    document.execCommand(withDelete ? "cut" : "copy");
  } catch {}
}

async function menuPaste(): Promise<void> {
  try {
    const t = await navigator.clipboard.readText();
    if (t) replaceSelection(t);
  } catch {
    pasteHint.value = true;
    if (pasteHintTimer) clearTimeout(pasteHintTimer);
    pasteHintTimer = setTimeout(() => (pasteHint.value = false), 2600);
    return;
  }
  closeMenu();
}

function menuSelectAll(): void {
  const el = ta.value;
  if (!el) return;
  el.focus();
  el.select();
  refreshMenuAnchors();
}

function onMenuKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    closeMenu();
    ev.stopPropagation();
  }
}

function onKeydown(ev: KeyboardEvent): void {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
    ev.preventDefault();
    if (!error.value) save();
    return;
  }
  if (ev.key === "Escape") {
    pine.closeEditor();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  canPaste.value = typeof navigator.clipboard?.readText === "function";
  // Initial compile — a blank editor stays quiet (no scary error banner)
  if (!code.value.trim()) return;
  const res = compile(code.value);
  if (res.ok) {
    compiledInputs.value = res.script.inputs;
    for (const inp of res.script.inputs) {
      if (localInputs.value[inp.title] === undefined) localInputs.value = { ...localInputs.value, [inp.title]: inp.def };
    }
  } else {
    error.value = res.error;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (compileTimer) clearTimeout(compileTimer);
  if (pasteHintTimer) clearTimeout(pasteHintTimer);
});
</script>

<template>
  <div class="pine-editor" @click.stop @keydown.stop>
    <div class="pe-head">
      <span class="pe-badge">Pine</span>
      <input v-model="name" class="pe-name" placeholder="Indicator name" aria-label="Indicator name" spellcheck="false" />
      <div class="pe-actions">
        <button class="pe-btn" type="button" @click="insertExample">Example</button>
        <button class="pe-btn primary" type="button" :disabled="!!error" :title="error ? 'Fix the error first' : 'Ctrl+S'" @click="save">
          {{ savedFlash ? "Added ✓" : pine.editingId ? "Save" : "Add to chart" }}
        </button>
        <button class="pe-btn icon" type="button" title="Close editor (ESC)" @click="pine.closeEditor()">✕</button>
      </div>
    </div>

    <div v-if="!code.trim()" class="pe-hint">Write your script, or press <b>Example</b> to start from a sample.</div>
    <button v-else-if="error" class="pe-error" type="button" @click="gotoLine(error.line)">
      <span class="pe-error-line">Line {{ error.line }}</span> {{ error.message }}
    </button>

    <div class="pe-body">
      <div class="pe-editor">
        <div class="pe-gutter" aria-hidden="true">
          <div class="pe-gutter-inner" :style="{ transform: `translateY(${-scrollTop}px)` }">
            <div v-for="n in lineCount" :key="n" class="pe-ln" :class="{ err: error?.line === n }">{{ n }}</div>
          </div>
        </div>
        <div class="pe-code-wrap">
          <pre class="pe-highlight" aria-hidden="true"><div class="pe-highlight-pad" :style="{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }" v-html="highlighted"></div></pre>
          <textarea
            ref="ta"
            v-model="code"
            class="pe-textarea"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            aria-label="Pine Script code"
            @scroll="syncScroll"
            @keydown.tab.prevent="onTab"
            @keydown.enter="onEnter"
            @contextmenu.prevent.stop="onContextMenu"
          ></textarea>
        </div>
      </div>

      <div v-if="compiledInputs.length" class="pe-inputs" :class="{ collapsed: !inputsPanelOpen }">
        <button class="pe-inputs-toggle" type="button" @click="inputsPanelOpen = !inputsPanelOpen">
          Inputs ({{ compiledInputs.length }}) <span class="pe-caret">{{ inputsPanelOpen ? "▾" : "▸" }}</span>
        </button>
        <div v-if="inputsPanelOpen" class="pe-inputs-list">
          <div v-for="inp in compiledInputs" :key="inp.title" class="pe-input-row">
            <span class="pe-input-label" :title="inp.title">{{ inp.title }}</span>
            <input
              v-if="inp.type === 'int'"
              class="pe-input-field"
              type="number"
              step="1"
              :value="Number(inputValues[inp.title] ?? inp.def)"
              @change="setInput(inp.title, Math.round(Number(($event.target as HTMLInputElement).value)))"
            />
            <input
              v-else-if="inp.type === 'float'"
              class="pe-input-field"
              type="number"
              step="any"
              :value="Number(inputValues[inp.title] ?? inp.def)"
              @change="setInput(inp.title, Number(($event.target as HTMLInputElement).value))"
            />
            <button
              v-else-if="inp.type === 'bool'"
              class="pe-input-check"
              :class="{ on: Boolean(inputValues[inp.title] ?? inp.def) }"
              type="button"
              @click="setInput(inp.title, !(inputValues[inp.title] ?? inp.def))"
            >
              {{ Boolean(inputValues[inp.title] ?? inp.def) ? "ON" : "OFF" }}
            </button>
            <input
              v-else-if="inp.type === 'color'"
              class="pe-input-color"
              type="color"
              :value="String(inputValues[inp.title] ?? inp.def)"
              @input="setInput(inp.title, String(($event.target as HTMLInputElement).value))"
            />
            <select
              v-else-if="inp.type === 'string' && inp.options?.length"
              class="pe-input-field"
              :value="String(inputValues[inp.title] ?? inp.def)"
              @change="setInput(inp.title, String(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="o in inp.options" :key="o" :value="o">{{ o }}</option>
            </select>
            <select
              v-else-if="inp.type === 'source'"
              class="pe-input-field"
              :value="String(inputValues[inp.title] ?? inp.def)"
              @change="setInput(inp.title, String(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="o in ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume']" :key="o" :value="o">{{ o }}</option>
            </select>
            <input v-else class="pe-input-field" type="text" :value="String(inputValues[inp.title] ?? inp.def)" @change="setInput(inp.title, String(($event.target as HTMLInputElement).value))" />
          </div>
        </div>
        <div class="pe-note">Pine v5 subset · ta.*/math.* · plot/hline/input</div>
      </div>
      <div v-else class="pe-note solo">Pine v5 subset · ta.*/math.* · plot/hline/input · errors show line numbers</div>
    </div>

    <!-- right-click menu -->
    <div v-if="menu" class="pe-ctx-backdrop" @pointerdown="closeMenu"></div>
    <div
      v-if="menu"
      class="pe-ctx"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
      @contextmenu.prevent.stop
      @keydown="onMenuKeydown"
    >
      <button class="pe-ctx-item" type="button" :disabled="!menu.hasSel" @click="menuCopy">
        Copy <span class="pe-ctx-k">Ctrl+C</span>
      </button>
      <button class="pe-ctx-item" type="button" :disabled="!menu.hasSel" @click="menuCut">
        Cut <span class="pe-ctx-k">Ctrl+X</span>
      </button>
      <button class="pe-ctx-item" type="button" :disabled="!canPaste" @click="menuPaste">
        Paste <span class="pe-ctx-k">Ctrl+V</span>
      </button>
      <button class="pe-ctx-item" type="button" @click="menuSelectAll">
        Select all <span class="pe-ctx-k">Ctrl+A</span>
      </button>
      <div v-if="pasteHint" class="pe-ctx-note">Clipboard blocked — press Ctrl+V inside the editor</div>
    </div>
  </div>
</template>

<style scoped>
.pine-editor {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 340px;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.35);
  z-index: 45;
  overflow: hidden;
}
.pe-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.pe-badge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--btn-bg);
  color: var(--text-muted);
  flex-shrink: 0;
}
.pe-name {
  flex: 1;
  min-width: 0;
  background: var(--btn-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  outline: none;
}
.pe-name:focus {
  border-color: var(--accent);
}
.pe-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.pe-btn {
  background: var(--btn-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 150ms;
}
.pe-btn:hover {
  border-color: var(--border-strong);
}
.pe-btn.primary {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(99, 102, 241, 0.9));
  border-color: transparent;
  color: #fff;
}
.pe-btn.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pe-btn.icon {
  width: 30px;
  padding: 6px 0;
  text-align: center;
}
.pe-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 340;
}
.pe-ctx {
  position: fixed;
  z-index: 341;
  min-width: 180px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.pe-ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  padding: 7px 10px;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
}
.pe-ctx-item:hover:not(:disabled) {
  background: var(--btn-hover);
}
.pe-ctx-item:disabled {
  opacity: 0.4;
  cursor: default;
}
.pe-ctx-k {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 700;
}
.pe-ctx-note {
  font-size: 10.5px;
  color: #f87171;
  padding: 6px 10px 4px;
}
.pe-hint {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 11px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.pe-hint b {
  color: var(--text);
}
.pe-error {
  display: block;
  width: 100%;
  text-align: left;
  background: rgba(248, 113, 113, 0.12);
  border: none;
  border-bottom: 1px solid rgba(248, 113, 113, 0.3);
  color: #f87171;
  font-size: 11px;
  font-weight: 600;
  padding: 7px 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.pe-error-line {
  font-weight: 800;
  margin-right: 6px;
}
.pe-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.pe-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  position: relative;
  background: var(--bg-watchlist);
}
.pe-gutter {
  width: 40px;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  padding-top: 10px;
}
.pe-gutter-inner {
  will-change: transform;
}
.pe-ln {
  height: 19px;
  line-height: 19px;
  text-align: center;
  font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.65;
}
.pe-ln.err {
  color: #f87171;
  opacity: 1;
  font-weight: 800;
}
.pe-code-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
}
.pe-highlight,
.pe-textarea {
  margin: 0;
  padding: 10px 12px;
  font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  line-height: 19px;
  tab-size: 4;
  white-space: pre;
  word-wrap: normal;
}
.pe-highlight {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: var(--text);
}
.pe-highlight-pad {
  will-change: transform;
}
.pe-textarea {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  color: transparent;
  caret-color: var(--text);
  overflow: auto;
}
.pe-textarea::selection {
  background: rgba(59, 130, 246, 0.3);
}
.tok-kw {
  color: #c792ea;
  font-weight: 700;
}
.tok-ns {
  color: #82aaff;
}
.tok-string {
  color: #c3e88d;
}
.tok-number {
  color: #f78c6c;
}
.tok-comment {
  color: var(--text-muted);
  opacity: 0.6;
  font-style: italic;
}
.tok-color {
  color: #ffcb6b;
  font-weight: 700;
}
.pe-inputs {
  width: 230px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pe-inputs-toggle {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
  padding: 4px 2px;
}
.pe-caret {
  margin-left: 4px;
}
.pe-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pe-input-label {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pe-input-field {
  width: 78px;
  background: var(--btn-bg);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  color: var(--text);
  font-size: 11px;
  padding: 4px 6px;
  outline: none;
}
.pe-input-field:focus {
  border-color: var(--accent);
}
.pe-input-color {
  width: 34px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  background: var(--btn-bg);
  cursor: pointer;
}
.pe-input-check {
  width: 50px;
  border-radius: 99px;
  border: 1px solid var(--glass-border);
  background: var(--btn-bg);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  padding: 4px 0;
  cursor: pointer;
}
.pe-input-check.on {
  background: rgba(45, 212, 167, 0.15);
  color: var(--live);
  border-color: rgba(45, 212, 167, 0.3);
}
.pe-note {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
  padding: 4px 2px;
  margin-top: auto;
}
.pe-note.solo {
  padding: 8px 10px;
}
@media (max-width: 768px) {
  .pine-editor {
    height: 260px;
  }
  .pe-inputs {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pine-editor,
  .pe-btn {
    transition-duration: 1ms !important;
  }
}
</style>
