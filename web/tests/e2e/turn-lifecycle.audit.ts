import { expect, test } from "@playwright/test";

const integrationFixtureAvailable =
  process.env.DEEPTUTOR_TURN_E2E_FIXTURE === "1";

test.describe("v2 turn lifecycle", () => {
  test.skip(
    !integrationFixtureAvailable,
    "Requires the deterministic backend turn fixture added with the multi-worker acceptance phase.",
  );

  test("keeps server-authoritative lifecycle states visible", async ({ page }) => {
    await page.goto("/");

    const composer = page.getByRole("textbox").last();
    await expect(composer).toBeVisible();
    await composer.fill("Explain replay-safe turns");
    await composer.press("Enter");

    const status = page.getByTestId("turn-status");
    await expect(status).toContainText(/queued|connecting/i);
    await expect(status).toContainText(/streaming|responding/i);
    await expect(status).toContainText(/waiting for input/i);

    await page.getByRole("textbox", { name: /answer/i }).fill("Continue");
    await page.getByRole("button", { name: /answer|submit/i }).click();
    await expect(status).toContainText(/streaming|responding/i);
    await expect(status).toContainText(/completed/i);
  });

  test("recovers without inventing a terminal failure", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox").last().fill("Start a long turn");
    await page.getByRole("textbox").last().press("Enter");

    const status = page.getByTestId("turn-status");
    await expect(status).toContainText(/streaming|responding/i);
    await page.getByTestId("fixture-drop-socket").click();
    await expect(status).toContainText(/recovering|reconnecting/i);
    await expect(status).not.toContainText(/failed/i);
    await expect(status).toContainText(/streaming|completed/i);
  });

  test("waits for cancellation acknowledgement", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox").last().fill("Start a cancellable turn");
    await page.getByRole("textbox").last().press("Enter");
    await page.getByRole("button", { name: /stop|cancel/i }).click();

    const status = page.getByTestId("turn-status");
    await expect(status).toContainText(/cancelling/i);
    await expect(status).toContainText(/cancelled/i);
  });
});
