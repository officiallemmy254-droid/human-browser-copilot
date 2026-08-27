---
name: human-browser
description: AI browser automation copilot with organic human kinematics (Bézier mouse curves, realistic typing cadence, inertial scrolling), Chrome Side Panel UI, anti-bot stealth, and long-running autonomous batch execution engine. Supports 3 execution modes: live Chrome extension (authenticated daily workflow), disposable ephemeral sandbox (safety testing untrusted URLs), and silent headless runner (zero-intrusion background batch tasks).
---

# Human Browser Copilot Skill

Use this skill when interacting with the web using human-like kinematics, logged-in user accounts, or executing heavy, long-running automated workflows (batch scraping, multi-page data processing, form fills).

## Execution Modes

1. **Active Chrome Extension Mode (`mode="extension"`)** (Default):
   - Controls your active, authenticated Chrome browser tab with zero browser restart required.
   - Sits in the Chrome Side Panel with live HUD, task progress bar, and action logs.
   - **Bulletproof MV3 Keepalive**: Offscreen document + alarms prevent service worker sleep during multi-hour jobs.
   - **Anti-Throttling**: Automatically sets `autoDiscardable: false` and CDP active lifecycle so Chrome doesn't freeze background tabs.
   - **Anti-Fatigue Pauses & Auto-Retry**: Randomized human pauses and exponential backoff retry.
   - **Auto-CAPTCHA Detection & Resume**: Pauses on challenges, alerts user, and auto-resumes once solved.
   - **3-Tier Security Policy**: Dual-synced human approval for sensitive forms, passwords, and payments.

2. **Disposable Sandbox Mode (`mode="sandbox"`)**:
   - Launches an isolated, temporary scratch Chromium instance.
   - Zero access to personal cookies or saved passwords (ideal for investigating unknown or untrusted links).
   - Automatically deletes scratch data on completion.

3. **Silent Headless Background Mode (`mode="headless"`)**:
   - Runs silently in the background without opening windows or moving physical mouse cursors.
   - Ideal for long-running batch scraping, scheduled tasks, or overnight workflows.

## Available MCP Tools

### Batch & Long-Running Automation
- `browser_batch_execute(name, steps, options)`: Runs an autonomous multi-step workflow inside the browser runtime without network roundtrip lag. Supports auto-retry, template variables (`{{var}}`), anti-fatigue pauses, and checkpoints.
- `browser_wait_for(condition, target, timeout, idleTimeMs)`: Dynamic waiter for selectors, text, URLs, or network idle.
- `browser_extract_data(extractType, selector, attributes)`: High-performance extraction of tables, lists, text, or Schema.org / JSON-LD metadata.
- `browser_evaluate_js(script)`: Safely evaluates JavaScript expressions in page context.
- `browser_manage_tabs(operation, url, tabId)`: Opens, switches, closes, or lists browser tabs.
- `browser_get_task_status()`: Queries the progress of an active batch task.
- `browser_cancel_task()`: Cancels an active batch task.

### Interactive Tools
- `browser_connect(mode, profile)`: Connects to Chrome. Profiles: `"natural"`, `"speedy"`, `"deep_reader"`, `"ghost_stealth"`.
- `browser_navigate(url)`: Navigates to a target web page.
- `browser_inspect_dom(limit)`: Scans visible interactive elements and returns structured items with numbered IDs.
- `browser_click(selector, elementId, elementText)`: Performs an organic human click along a Bézier curve.
- `browser_type(selector, elementId, text)`: Types into an input field with natural keystroke timing.
- `browser_scroll(distanceY)`: Smoothly scrolls down/up with reading pauses.
- `browser_take_snapshot()`: Takes a viewport screenshot (Base64 JPEG).
- `browser_solve_captcha_wait()`: Suspends execution until the user solves an in-page CAPTCHA.

## Batch Workflow Example

```json
{
  "name": "Scrape Product Catalog",
  "steps": [
    { "action": "navigate", "url": "https://example.com/products" },
    { "action": "wait_for", "condition": "selector", "target": ".product-grid" },
    { "action": "scroll", "distanceY": 600 },
    { "action": "extract", "extractType": "table", "selector": "#price-table", "variable": "prices" },
    { "action": "extract", "extractType": "elements", "selector": ".product-card a", "attributes": ["href", "title"], "variable": "items" }
  ],
  "options": {
    "retryCount": 3,
    "stepDelayMs": 500,
    "antiFatiguePauses": true
  }
}
```
