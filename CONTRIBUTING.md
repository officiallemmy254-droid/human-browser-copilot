# Contributing to Human Browser Copilot 🌐

Thank you for your interest in contributing to **Human Browser Copilot**! We are building an open-source, agentic browser automation runtime with organic human kinematics, Liquid Morphism Chrome side panel, anti-bot stealth, and Model Context Protocol (MCP) bridges.

---

## 🧭 Project Architecture

The repository is organized into three decoupled layers:

```
human-browser/
├── extension/          # Manifest V3 Chrome Extension (Sidepanel, Offscreen Keepalive, Content Overlays, CDP)
├── host/               # Native Messaging Host & MCP Server (TypeScript, Playwright fallback, IPC Daemon)
├── docs/               # Architecture specs, Milestones (M0–M27), Security models
└── skill/              # Antigravity CLI & OpenCode skill integration
```

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Node.js**: `v20+` or `v22+`
- **Google Chrome** or **Brave Browser**
- **npm** or **pnpm**

### 2. Install Dependencies & Build Host
```bash
cd host
npm install
npm run build
```

### 3. Run Automated Tests
```bash
npm test
```
All 31 unit & integration test suites (228+ tests) should pass.

### 4. Load Unpacked Chrome Extension
1. Open Chrome and navigate to `chrome://extensions/`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` directory.

### 5. Register Native Messaging Host (Windows)
```powershell
cd host
powershell -ExecutionPolicy Bypass -File install_host.ps1
```

---

## 🎯 Areas We Welcome Contributions

We are actively seeking contributions across the following key areas:

### 1. 🌐 Cross-Platform Native Host Installers
- **macOS / Linux Support**: Add `install_host.sh` for macOS (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts`) and Linux (`~/.config/google-chrome/NativeMessagingHosts`).

### 2. 🥷 Stealth & Anti-Fingerprinting
- Fine-tuning Bézier mouse trajectory randomness and human typing dwell profiles.
- Enhancing CAPTCHA detection coverage for Turnstile, Arkose Labs, Geetest, and AWS WAF challenges.

### 3. 🧩 Rich Web App Adapters & Complex Editor Support
- Specialized support for Canvas/WebGL AI suites (e.g. Google Flow, Midjourney web, Runway, Sora, Suno).
- Custom hotkey shortcuts and element locators for modern SPAs.

### 4. 🗂️ Multi-Tab Concurrency & Parallel Agent Mesh
- Enhancing real-time tab locking, multi-worker telemetry, and background batch execution pipelines.

### 5. 🎨 UI/UX & Liquid Morphism Side Panel
- New visual themes, interactive canvas overlays, real-time audio telemetry, and workflow templates.

---

## 📜 Pull Request Guidelines

1. **Fork the repo** and create a descriptive feature branch (e.g. `feat/macos-installer` or `fix/lexical-editor`).
2. Ensure all tests pass (`npm test` in `host/`).
3. Add unit or integration tests for new features.
4. Open a clean Pull Request with a summary of changes and test evidence.

Thank you for helping build the future of agentic browser copilot runtimes! 🚀
