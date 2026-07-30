import { chromium } from "playwright";

console.log("[TEST] Starting browser test...");
console.log("[TEST] Node:", process.version);
console.log("[TEST] Platform:", process.platform);

const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    timeout: 60_000,
});

console.log("[TEST] Browser launched");

const page = await browser.newPage();

console.log("[TEST] Page created");

await page.goto(
    "https://example.com",
    {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
    },
);

console.log(
    "[TEST] Page title:",
    await page.title(),
);

await page.waitForTimeout(5_000);

await browser.close();

console.log("[TEST] Done");
