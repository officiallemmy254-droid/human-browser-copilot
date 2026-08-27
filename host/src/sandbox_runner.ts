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
  return "chrome";
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

export async function sandboxHumanClick(page: Page, selector: string) {
  const el = await page.waitForSelector(selector, { timeout: 15000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 6;
  const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 6;

  await page.mouse.move(targetX, targetY, { steps: 20 });
  await page.waitForTimeout(50 + Math.random() * 40);

  await page.mouse.down();
  await page.waitForTimeout(60 + Math.random() * 40);
  await page.mouse.up();
}

export async function sandboxHumanType(page: Page, selector: string, text: string) {
  await sandboxHumanClick(page, selector);
  for (const char of text) {
    await page.keyboard.type(char);
    const delay = 35 + Math.random() * 60 + (char === " " ? 40 : 0);
    await page.waitForTimeout(delay);
  }
}

export async function sandboxWaitFor(page: Page, condition: string, target: string, timeout: number = 30000) {
  if (condition === "selector") {
    await page.waitForSelector(target, { timeout });
    return { ok: true };
  } else if (condition === "text") {
    await page.waitForFunction(t => document.body && document.body.innerText.includes(t), target, { timeout });
    return { ok: true };
  } else if (condition === "url") {
    await page.waitForURL(target, { timeout });
    return { ok: true };
  } else if (condition === "network_idle") {
    await page.waitForLoadState("networkidle", { timeout });
    return { ok: true };
  } else if (condition === "timeout" || condition === "sleep") {
    const ms = Number(target) || timeout || 1000;
    await page.waitForTimeout(ms);
    return { sleptMs: ms };
  }
  throw new Error(`Unknown condition: ${condition}`);
}

export async function sandboxExtractData(page: Page, extractType: string, selector?: string, attributes?: string[]) {
  if (extractType === "table") {
    return await page.evaluate((sel) => {
      const table = document.querySelector(sel || "table");
      if (!table) return { error: "Table not found" };
      const headers: string[] = [];
      const rows: any[] = [];
      table.querySelectorAll("thead th, tr:first-child th").forEach(th => headers.push(th.textContent?.trim() || ""));
      table.querySelectorAll("tbody tr, tr").forEach(tr => {
        const cells = tr.querySelectorAll("td, th");
        if (!cells.length) return;
        const row: any = {};
        cells.forEach((c, idx) => {
          const k = headers[idx] || `col_${idx}`;
          row[k] = c.textContent?.trim() || "";
        });
        rows.push(row);
      });
      return { rowCount: rows.length, headers, rows };
    }, selector);
  } else if (extractType === "elements") {
    return await page.evaluate(({ sel, attrs }) => {
      const els = Array.from(document.querySelectorAll(sel || "a"));
      return els.slice(0, 300).map((el, i) => {
        const item: any = { index: i, tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 150) };
        (attrs || ["href", "src", "value", "id"]).forEach((attr: string) => {
          const v = el.getAttribute(attr);
          if (v !== null) item[attr] = v;
        });
        return item;
      });
    }, { sel: selector, attrs: attributes });
  } else if (extractType === "structured") {
    return await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const jsonLd = scripts.map(s => {
        try { return JSON.parse(s.textContent || ""); } catch (e) { return null; }
      }).filter(Boolean);
      return { title: document.title, url: window.location.href, jsonLd };
    });
  } else if (extractType === "text") {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel || "body");
      return el?.textContent?.trim() || "";
    }, selector);
  }
  throw new Error(`Unknown extractType: ${extractType}`);
}
