---
name: human-browser
description: AI browser automation copilot with organic human kinematics (Bézier mouse curves, realistic typing cadence, inertial scrolling), Chrome Side Panel UI, and anti-bot stealth. Supports 3 execution modes: live Chrome extension (authenticated daily workflow), disposable ephemeral sandbox (safety testing untrusted URLs), and silent headless runner (zero-intrusion background batch tasks).
---

# Human Browser Copilot Skill

Use this skill when interacting with the web using human-like kinematics, logged-in user accounts, or running long background tasks and complex workflows.

## Execution Modes

1. **Active Chrome Extension Mode (`mode="extension"`)** (Default):
   - Controls your active, authenticated Chrome browser tab with zero browser restart required.
   - Sits in the Chrome Side Panel with live HUD, laser cursor tracer, and action logs.
   - Automatically pauses on CAPTCHA / Cloudflare challenges, alerts the user, and auto-resumes once solved.
   - Enforces a 3-tier security policy with dual-synced human approval for sensitive forms, passwords, and payments.

2. **Disposable Sandbox Mode (`mode="sandbox"`)**:
   - Launches an isolated, temporary scratch Chromium instance.
   - Zero access to personal cookies or saved passwords (ideal for investigating unknown or untrusted links).
   - Automatically deletes scratch data on completion.

3. **Silent Headless Background Mode (`mode="headless"`)**:
   - Runs silently in the background without opening windows or moving physical mouse cursors.
   - Ideal for long-running batch scraping, scheduled tasks, or overnight workflows.

## Available MCP Tools

- `browser_connect(mode, profile)`: Connects to Chrome. Profiles: `"natural"`, `"speedy"`, `"deep_reader"`, `"ghost_stealth"`.
- `browser_navigate(url)`: Navigates to a target web page.
- `browser_inspect_dom(limit)`: Scans visible interactive elements and returns structured items with numbered IDs.
- `browser_click(selector, elementId, elementText)`: Performs an organic human click along a Bézier curve.
- `browser_type(selector, elementId, text)`: Types into an input field with natural keystroke timing.
- `browser_scroll(distanceY)`: Smoothly scrolls down/up with reading pauses.
- `browser_take_snapshot()`: Takes a viewport screenshot (Base64 JPEG).
- `browser_solve_captcha_wait()`: Suspends execution until the user solves an in-page CAPTCHA.

## Best Practices

- Always call `browser_inspect_dom` first to get the numeric element IDs for buttons or links.
- When clicking state-changing buttons (e.g. submit, checkout), provide `elementText` so the security evaluator can classify the risk level appropriately.
