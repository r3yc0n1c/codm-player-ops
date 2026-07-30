import "dotenv/config";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";


type ClaimStatus = "already_claimed" | "claimed" | "failed";
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let claimStatus: ClaimStatus = "failed";

const isDevelopment = process.env.NODE_ENV === "development";
const timestamp = new Date().toISOString().replaceAll(":", "-");

const screenshotDir = isDevelopment ? path.resolve("screenshots") : undefined;

if (screenshotDir) {
    console.log("[BOOT] Creating screenshots directory: ", screenshotDir);

    await mkdir(
        screenshotDir,
        {
            recursive: true,
        },
    );
}

async function takeScreenshot(
    page: import("playwright").Page,
    filename: string,
) {
    if (!screenshotDir) {
        return;
    }

    await page.screenshot({
        path: path.join(
            screenshotDir,
            filename,
        ),
        fullPage: true,
    });
}

console.log("[BOOT] Script started");

const playerId = process.env.CODM_PLAYER_ID;
const storeUrl = process.env.CODM_STORE_URL;
const headless = process.env.HEADLESS !== "false";

const maskedPlayerId = playerId
    ? `${playerId.slice(0, 4)}...${playerId.slice(-4)}`
    : "MISSING";

console.log("[BOOT] Environment loaded");
console.log("[BOOT] Player ID:", maskedPlayerId);
console.log("[BOOT] Store URL:", storeUrl);
console.log("[BOOT] Headless:", headless);

if (!playerId) {
    throw new Error("CODM_PLAYER_ID is missing in .env");
}

try {
    console.log("[BOOT] Launching browser...");

    browser = await chromium.launch({
        headless,
        slowMo: headless ? 0 : 250,
        timeout: 60_000,
    });

    console.log("[BOOT] Browser launched.");

    context = await browser.newContext({
        viewport: {
            width: 1440,
            height: 1000,
        },
        locale: "en-IN",
        timezoneId: "Asia/Kolkata",
    });

    const page = await context.newPage();

    page.on("console", (message) => {
        if (message.type() === "error") {
            console.error("[BROWSER ERROR]", message.text());
        }
    });

    page.on("pageerror", (error) => {
        console.error("[PAGE ERROR]", error.message);
    });

    page.on("requestfailed", (request) => {
        console.error(
            "[REQUEST FAILED]",
            request.method(),
            request.url(),
            request.failure()?.errorText
        );
    });

    console.log("[CODM] Opening store...");

    await page.goto(storeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
    });

    console.log("[CODM] Store opened:", page.url());

    await takeScreenshot(
        page,
        `${timestamp}-initial.png`,
    );

    console.log("[CODM] Looking for Player ID input...");

    const playerIdInput = page
        .locator(
            [
                'input[placeholder*="Player ID" i]',
                'input[name*="player" i]',
                'input[name*="userId" i]',
                'input[id*="player" i]',
                'input[id*="userId" i]',
            ].join(", ")
        )
        .first();

    await playerIdInput.waitFor({
        state: "visible",
        timeout: 30_000,
    });

    console.log("[CODM] Player ID input found.");

    await playerIdInput.fill(playerId);
    await page.waitForTimeout(5000);

    console.log("[CODM] Player ID entered.");

    /*
     * Some reactive forms only complete
     * account/product loading after the
     * input loses focus.
     */
    await playerIdInput.blur();
    await page.waitForTimeout(5000);

    console.log("[CODM] Waiting for Daily Gift...");

    const dailyGiftCard = page.locator('[capture-custom-sku-name="DAILY GIFT"]');

    await dailyGiftCard.waitFor({
        state: "visible",
        timeout: 30_000,
    });

    console.log("[CODM] Daily Gift found.");

    await takeScreenshot(
        page,
        `${timestamp}-after-player-id.png`,
    );

    const dailyGiftOption = dailyGiftCard.locator(
        "xpath=ancestor::div[@role='radio'][1]"
    );

    const redeemedOverlay = dailyGiftCard.locator(".purchased-overlay--redeemed");

    const isAlreadyClaimed = await redeemedOverlay.isVisible().catch(() => false);

    if (isAlreadyClaimed) {
        claimStatus = "already_claimed";

        console.log("[CODM] Daily Gift is already claimed.");
    } else {
        const actionLabel = dailyGiftCard.locator(
            ".price-section__price__price-container__amount"
        );

        await actionLabel.waitFor({
            state: "visible",
            timeout: 10_000,
        });

        const actionText = await actionLabel.innerText();

        console.log("[CODM] Daily Gift action:", actionText.trim());

        if (!/^claim gift$/i.test(actionText.trim())) {
            throw new Error(
                ["Unexpected Daily Gift state:", actionText.trim()].join(" ")
            );
        }

        console.log("[CODM] Daily Gift is available.");

        console.log("[CODM] Selecting Daily Gift...");

        await dailyGiftOption.click();

        await page.waitForFunction(
            () => {
                const card = document.querySelector(
                    '[capture-custom-sku-name="DAILY GIFT"]'
                );

                const option = card?.closest('[role="radio"]');

                return option?.getAttribute("aria-checked") === "true";
            },
            undefined,
            {
                timeout: 10_000,
            }
        );

        console.log("[CODM] Daily Gift selected.");

        console.log("[CODM] Waiting for claim modal...");

        const claimModal =
            page.locator('[data-testid="sheet-dialog"]');


        await claimModal.waitFor({
            state: "visible",
            timeout: 15_000,
        });

        const modalText =
            await claimModal
                .innerText()
                .catch(() => "");

        console.log("[CODM] Initial modal:", modalText);

        const modalTitle = claimModal.locator('[data-testid="modal-title"]');

        await modalTitle.waitFor({
            state: "visible",
            timeout: 10_000,
        });

        console.log("[CODM] Waiting for account verification...");

        await page.waitForFunction(
            () => {
                const title = document
                    .querySelector('[data-testid="modal-title"]')
                    ?.textContent?.trim()
                    ?.toLowerCase();

                return title === "claim gift" || title === "gift claimed";
            },
            undefined,
            {
                timeout: 90_000,
                polling: 1000,
            }
        );

        const title = await modalTitle.innerText();

        console.log("[CODM] Modal ready:", title);

        if (!["claim gift", "gift claimed"].includes(title.trim().toLowerCase())) {
            throw new Error(`Unexpected modal title after loading: ${title}`);
        }

        console.log("[CODM] Modal state:", title);

        if (title.trim().toLowerCase() === "claim gift") {
            const rewardTitle = claimModal.locator(
                ".freebie-redeem-modal__reward-title"
            );

            await rewardTitle.waitFor({
                state: "visible",
                timeout: 10_000,
            });

            const rewardName = await rewardTitle.innerText();

            if (!/^daily gift$/i.test(rewardName.trim())) {
                throw new Error(
                    ["Unexpected reward in claim modal:", rewardName.trim()].join(" ")
                );
            }

            console.log(`[CODM] Reward confirmed: ${rewardName.trim()}`);
        }

        const claimButton = claimModal.locator('[data-testid="claim-button"]');

        await claimButton.waitFor({
            state: "visible",
            timeout: 10_000,
        });

        await claimButton.scrollIntoViewIfNeeded();

        console.log("[CODM] Clicking final CLAIM GIFT button...");

        await claimButton.click();

        console.log("[CODM] Claim request submitted.");

        console.log("[CODM] Waiting for claim confirmation...");

        const giftClaimedTitle = claimModal.locator('[data-testid="modal-title"]');

        const claimResult = await Promise.race([
            giftClaimedTitle
                .filter({
                    hasText: "Gift Claimed",
                })
                .waitFor({
                    state: "visible",
                    timeout: 30_000,
                })
                .then(() => "claimed"),

            redeemedOverlay
                .waitFor({
                    state: "visible",
                    timeout: 30_000,
                })
                .then(() => "redeemed"),
        ]).catch(() => "failed");

        if (claimResult === "claimed" || claimResult === "redeemed") {
            claimStatus = "claimed";

            console.log("[CODM] Daily Gift claimed successfully.");

            const modalText = await claimModal.innerText().catch(() => "");

            console.log("[CODM] Confirmation modal:", modalText);
        } else {
            const modalText = await claimModal
                .innerText()
                .catch(() => "Unable to read modal");

            const cardText = await dailyGiftCard
                .innerText()
                .catch(() => "Unable to read Daily Gift card");

            throw new Error(
                [
                    "Could not verify claim.",
                    `Modal: ${modalText}`,
                    `Card: ${cardText}`,
                ].join(" ")
            );
        }

        const closeButton = claimModal.locator('[data-testid="close-button"]');

        if (await closeButton.isVisible().catch(() => false)) {
            await closeButton.click();

            console.log("[CODM] Closed confirmation modal.");
        }
    }

    await takeScreenshot(
        page,
        `${timestamp}-${claimStatus}.png`,
    );

    console.log(`[CODM] Final status: ${claimStatus}`);
} catch (error) {
    claimStatus = "failed";

    console.error("[CODM] Automation failed:", error);

    if (context) {
        const errorPage = context.pages()[0];

        await takeScreenshot(
            errorPage,
            `${timestamp}-error.png`,
        );
    }

    process.exitCode = 1;
} finally {
    console.log("[CLEANUP] Closing browser...");

    await context?.close().catch((error) => {
        console.error("[CLEANUP] Failed to close context:", error);
    });

    await browser?.close().catch((error) => {
        console.error("[CLEANUP] Failed to close browser:", error);
    });

    console.log("[CLEANUP] Done.");
}
