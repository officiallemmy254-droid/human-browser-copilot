# AI Browser Runtime — Architecture & Technical Contract

## 1. System Purpose & Scope

The **AI Browser Runtime** is a general-purpose, application-agnostic infrastructure allowing external AI agents (Codex, Antigravity, Claude-based agents, OpenCode, and standard MCP clients) to safely observe and operate a user''s Chrome browser.

The architecture strictly separates responsibilities:
* **The AI Agent** owns intent, planning, business logic, reasoning, and deciding what data matters.
* **The Browser Runtime** owns perception, interaction, technical permission enforcement, synchronization, action verification, tab concurrency, auditability, and emergency handoffs.

---

## 2. Layered Architecture Pipeline

```
  AI AGENT (Codex, Antigravity, MCP Client)
      ↓
  AGENT INTERFACE / MCP ADAPTER
      ↓
  LOCAL AUTHENTICATION (M9)
      ↓
  POLICY ENGINE & ORIGIN AUTHORIZER (M7, M8)
      ↓
  APPROVAL BROKER & STATE MACHINE (M10)
      ↓
  SESSION & TAB CONCURRENCY MANAGER (M5, M14)
      ↓
  CANONICAL BROWSER API (M2 - M5, M31)
      ↓
  BROWSER RUNTIME ENGINE
      ↓
  CHROME (Extension + CDP + DOM)
```

There is **no direct bypass path** from the agent to the browser. Every command must pass sequentially through authentication, policy evaluation, approval checks, session locks, and pre/post action verification.

---

## 3. Canonical Interaction Hierarchy (M3)

Interaction primitives are executed in a strict fallback hierarchy:

1. **LEVEL 1 (Semantic DOM & Accessibility)**: Interacting via accessible roles, standard DOM event dispatch, and form controls.
2. **LEVEL 2 (Chrome APIs)**: Native extension APIs (`chrome.tabs`, `chrome.scripting`).
3. **LEVEL 3 (Chrome DevTools Protocol - CDP)**: Trusted input dispatch (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`).
4. **LEVEL 4 (Visual / Coordinate Interaction)**: Future scope fallback.

---

## 4. Observation & Stale Element Contract (M2, M19)

* Observation responses return structured metadata (`el_1`, `el_2`, ...) rather than raw HTML.
* Element IDs are valid **ONLY** for the observation snapshot that produced them.
* If DOM mutations or page reloads occur after snapshot generation, referencing an invalid ID returns `STALE_ELEMENT`.
* Observation data is strictly bounded by configurable limits (`MAX_PAGE_TEXT_LENGTH`, `MAX_ELEMENTS`, etc.) with `truncated: true` explicitly reported if limits are reached.

---

## 5. Error Taxonomy & Boundaries (M12)

No raw or untyped exceptions cross the Browser API boundary. All errors are mapped to canonical typed errors:
* `STALE_ELEMENT`
* `TAB_NOT_FOUND`
* `TAB_LOCKED`
* `DEBUGGER_CONFLICT`
* `TIMEOUT`
* `INVALID_STATE`
* `TASK_CANCELLED`
* `POLICY_DENIED`
* `APPROVAL_REQUIRED`
* `APPROVAL_TIMEOUT`
* `HUMAN_REQUIRED`
* `MODAL_BLOCKING`
* `ORIGIN_NOT_ALLOWED`
* `AUTHENTICATION_REQUIRED`
* `VERIFICATION_FAILED`
* `UNSUPPORTED_OPERATION`
* `UNKNOWN_ERROR`

---

## 6. Concurrency & Concurrency Rules (M14)

* **One active task per tab**. A second task attempting to attach to an active tab receives `TAB_LOCKED`.
* Multi-tab concurrency default limit: `MAX_CONCURRENT_TASKS = 3`.
* Emergency Stop (`M17`) immediately transitions the runtime into `STOPPING` → `STOPPED`, rejecting all subsequent queued commands.
