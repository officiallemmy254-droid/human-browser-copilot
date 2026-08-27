// Human Browser Host - Mode 2 (Sandbox) & Mode 3 (Silent Headless) Engine
import { chromium, Browser, BrowserContext, Page } from "playwright-core";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let activeBrowser: Browser | null = null;
let activeContext: BrowserContext | null = null;
let activePage: Page | null = null;
let currentSandboxDir: string | null = null;

function findChromeExecutable(): string {
  const commonPaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "chrome"; // fallback to PATH
}

export async function launchSandbox(options: { headless?: boolean; isEphemeral?: boolean } = {}): Promise<Page> {
  const { headless = false, isEphemeral = true } = options;

  if (activePage && !activePage.isClosed()) {
    return activePage;
  }

  const chromePath = findChromeExecutable();
  let contextOptions: any = {
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
  };

  if (isEphemeral) {
    currentSandboxDir = path.join(os.tmpdir(), `human-browser-sandbox-${Date.now()}`);
    fs.mkdirSync(currentSandboxDir, { recursive: true });

    activeContext = await chromium.launchPersistentContext(currentSandboxDir, {
      executablePath: chromePath,
      headless: headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-infobars"
      ],
      ...contextOptions
    });
    activePage = activeContext.pages()[0] || await activeContext.newPage();
  } else {
    activeBrowser = await chromium.launch({
      executablePath: chromePath,
      headless: headless,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    activeContext = await activeBrowser.newContext(contextOptions);
    activePage = await activeContext.newPage();
  }

  return activePage;
}

export async function closeSandbox() {
  if (activeContext) {
    await activeContext.close().catch(() => {});
    activeContext = null;
  }
  if (activeBrowser) {
    await activeBrowser.close().catch(() => {});
    activeBrowser = null;
  }
  activePage = null;

  if (currentSandboxDir && fs.existsSync(currentSandboxDir)) {
    try {
      fs.rmSync(currentSandboxDir, { recursive: true, force: true });
    } catch (e) {}
    currentSandboxDir = null;
  }
}

export function getActiveSandboxPage(): Page | null {
  return activePage;
}

/**
 * Human-like mouse movement in Playwright
 */
export async function sandboxHumanClick(page: Page, selector: string) {
  const el = await page.waitForSelector(selector, { timeout: 8000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 6;
  const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 6;

  // Move smoothly
  await page.mouse.move(targetX, targetY, { steps: 25 });
  await page.waitForTimeout(50 + Math.random() * 50);

  // Click
  await page.mouse.down();
  await page.waitForTimeout(60 + Math.random() * 40);
  await page.mouse.up();
}

/**
 * Human-like typing in Playwright
 */
export async function sandboxHumanType(page: Page, selector: string, text: string) {
  await sandboxHumanClick(page, selector);
  for (const char of text) {
    await page.keyboard.type(char);
    const delay = 40 + Math.random() * 70 + (char === " " ? 50 : 0);
    await page.waitForTimeout(delay);
  }
}
