# 🌐 Human Browser Copilot ("Antigravity in Chrome")

An agentic Chrome Extension, local Native Messaging Host, and Model Context Protocol (MCP) bridge inspired by **Claude in Chrome (Claude Code)**. Built for **Antigravity CLI**, **Antigravity 2.0**, and **OpenCode**.

It delivers **organic human kinematics** (Bézier mouse curves, realistic typing cadence, and smooth scrolling with reading pauses), **3-Tier Security with Dual-Synced Human Approvals**, **Auto-CAPTCHA Detection & Resume**, **Autonomous Batch Execution Engine**, and **Bulletproof MV3 Keepalive for Heavy, Long-Running Automated Tasks**.

---

## 🚀 3 Operating Modes

1. **🌟 Mode 1: Active Chrome Extension (Copilot)** *(Default)*
   - Attaches directly to your active, authenticated Chrome browser tab via `chrome.debugger`.
   - Preserves all your logins, Google accounts, and cookies with zero browser restart needed.
   - Sits in the **Chrome Side Panel** with a live activity log, task progress bar, and visual HUD.
   - **Bulletproof MV3 Keepalive**: Offscreen document + alarms prevent service worker sleep during multi-hour jobs.
   - **Anti-Throttling**: Automatically sets `autoDiscardable: false` and CDP active lifecycle so Chrome doesn't freeze background tabs.
   - **Anti-Fatigue Pauses & Auto-Retry**: Randomized human pauses and exponential backoff retry for large-scale operations.
   - Automatically pauses on CAPTCHA / Cloudflare Turnstile, alerts you, and auto-resumes once solved.
2. **🧪 Mode 2: Ephemeral Disposable Sandbox**
   - Launches an isolated scratch Chromium instance in a temporary directory.
   - **Zero access to personal passwords or cookies** (ideal for testing untrusted URLs).
   - Auto-cleans and destroys scratch directories on task completion.
3. **🌙 Mode 3: Silent Headless Background Runner**
   - Runs silently in the background with **zero screen intrusion** (no popping windows, no cursor stealing).
   - Ideal for overnight scraping, heavy data batch jobs, or long-running tasks while you work or game.

---

## ⚡ Autonomous Batch Execution & Heavy Tasks

Execute multi-step automation directly inside the browser runtime without network roundtrip lag:

```json
{
  "name": "Extract Multi-Page Directory",
  "steps": [
    { "action": "navigate", "url": "https://example.com/items" },
    { "action": "wait_for", "condition": "selector", "target": ".data-table", "timeout": 30000 },
    { "action": "extract", "extractType": "table", "selector": ".data-table", "variable": "tableData" },
    { "action": "extract", "extractType": "elements", "selector": ".item-link", "attributes": ["href"], "variable": "links" }
  ],
  "options": {
    "retryCount": 3,
    "stepDelayMs": 400,
    "antiFatiguePauses": true
  }
}
```

---

## 📦 Project Structure

```
human-browser/
├── extension/                             # Manifest V3 Chrome Extension
│   ├── manifest.json                      # Permissions: debugger, sidePanel, nativeMessaging, alarms, offscreen
│   ├── offscreen/                         # MV3 Offscreen Keepalive Worker
│   │   ├── offscreen.html
│   │   └── offscreen.js                   # Persistent port & heartbeat
│   ├── icons/                             # 16x16, 48x48, 128x128 icons
│   ├── sidepanel/                         # Chrome Side Panel UI
│   │   ├── sidepanel.html                 # Chat, Batch Task Progress, CAPTCHA Alert, Approvals
│   │   ├── sidepanel.css                  # Dark glassmorphic aesthetic
│   │   └── sidepanel.js                   # Live telemetry, timer, chimes & approval state
│   ├── content/                           # In-page Visual Overlays
│   │   ├── overlay.css
│   │   ├── tracer.js                      # Animated laser cursor & click ripples
│   │   ├── highlighter.js                 # Interactive element bounding-box numbers
│   │   └── captcha_detector.js            # Auto-watcher for Turnstile, reCAPTCHA & hCaptcha
│   └── background/
│       ├── service_worker.js              # Native messaging router & command dispatcher
│       ├── workflow_engine.js             # Autonomous batch task runner with retries & checkpoints
│       ├── kinematics.js                  # Bézier curve math & typing rhythm
│       ├── debugger_cdp.js                # CDP input dispatcher, anti-throttling, memory GC
│       ├── security_guard.js              # 3-Tier security policy & approval coordinator
│       └── keepalive.js                   # Offscreen keepalive & alarms manager
│
├── host/                                  # Native Messaging Host & MCP Server
│   ├── package.json
│   ├── tsconfig.json
│   ├── install_host.ps1                   # Windows Registry setup script
│   ├── com.antigravity.human_browser.json # Native Host Manifest
│   ├── run_host.bat                       # Native host launch script
│   └── src/
│       ├── index.ts                       # Dual-mode entrypoint (MCP / Native stdio)
│       ├── mcp_server.ts                  # MCP Tools definitions (batch, wait_for, extract, manage_tabs)
│       ├── sandbox_runner.ts              # Playwright sandbox & headless engine
│       ├── security_policy.ts             # Host-side audit logger & CLI approval prompt
│       └── native_bridge.ts               # Stdio 32-bit packet protocol & IPC daemon
│
└── skill/                                 # Antigravity CLI Custom Skill
    └── human-browser/
        └── SKILL.md
```

---

## 🛠️ Quick Installation & Setup

### 1. Load the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top right corner).
3. Click **Load unpacked** (or click the reload icon if already loaded) and select the `extension/` folder:
   ```
   C:\Users\SIR\human-browser\extension
   ```
4. Open the extension icon to pin it or open the Side Panel!

### 2. Register the Native Messaging Host
Open PowerShell as Administrator (or standard user) and run:
```powershell
cd C:\Users\SIR\human-browser\host
powershell -ExecutionPolicy Bypass -File install_host.ps1
```

### 3. Connect to Antigravity CLI or OpenCode
Add the MCP Server to your Antigravity / OpenCode MCP config file:

```json
{
  "mcpServers": {
    "human-browser": {
      "command": "node",
      "args": ["C:/Users/SIR/human-browser/host/dist/index.js", "--mcp"]
    }
  }
}
```

---

## 🔒 Smart 3-Tier Security Policy

- **Tier 1 (Safe / Read)**: `inspect_dom`, `take_snapshot`, `scroll`, `extract_data` execute instantly.
- **Tier 2 (Routine Mutation)**: Clicking links, menus, search queries run with live visual indicators and audit logging.
- **Tier 3 (Sensitive / High-Risk)**: Form submission, passwords, credit card inputs, "Buy"/"Delete"/"Confirm" buttons, OAuth consent screens **pause the agent** and require human sign-off via the Side Panel or CLI.

---

## 🥷 Kinematics Profiles

- 🚶 **Natural**: Realistic human speed with standard cadence and reading pauses.
- 🏎️ **Speedy**: Rapid execution with minimal humanized jitter.
- 📖 **Deep Reader**: Slower scrolling, thorough reading dwell times, and casual mouse drift.
- 🥷 **Ghost Stealth**: Maximum anti-fingerprinting, randomized micro-delays, and deep stealth evasion.
