// Verification test script for Sandbox and Headless modes
import { launchSandbox, closeSandbox, sandboxHumanClick, sandboxHumanType } from "./sandbox_runner.js";

async function runVerification() {
  console.log("🚀 Starting Human Browser Verification Suite...");

  try {
    console.log("1. Testing Mode 3 (Silent Headless Runner)...");
    const page = await launchSandbox({ headless: true, isEphemeral: true });
    
    console.log("2. Navigating to https://example.com...");
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    const title = await page.title();
    console.log(`   ✅ Page Title: "${title}"`);

    console.log("3. Testing DOM inspection...");
    const text = await page.locator("h1").innerText();
    console.log(`   ✅ Heading Text: "${text}"`);

    console.log("4. Testing organic human click & navigation...");
    await sandboxHumanClick(page, "a");
    await page.waitForTimeout(1000);
    console.log(`   ✅ Navigated to: ${page.url()}`);

    console.log("5. Testing viewport snapshot capture...");
    const screenshot = await page.screenshot({ type: "jpeg", quality: 80 });
    console.log(`   ✅ Screenshot captured: ${screenshot.length} bytes`);

    await closeSandbox();
    console.log("6. Cleaned up disposable sandbox scratch files.");
    console.log("🎉 ALL HEADLESS & SANDBOX TESTS PASSED SUCCESSFULLY!");
  } catch (err: any) {
    console.error("❌ Test failed:", err);
    await closeSandbox();
    process.exit(1);
  }
}

runVerification();
