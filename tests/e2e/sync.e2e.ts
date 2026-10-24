import { expect, invokedCalls, test } from "./helpers";

// Real pairing needs two apps on one network; here the IPC stub stands in for the transport
test("Sync page names this device, starts the transport while open and stops it on leaving", async ({ page }) => {
  await page.getByRole("button", { name: "Sync" }).first().click();
  await expect(page.getByRole("heading", { name: "Sync", exact: true })).toBeVisible();
  await expect(page.getByLabel("This device's name")).toHaveValue("Mac");
  await expect(page.getByText("No paired devices yet")).toBeVisible();
  await expect(page.locator(".sync-status")).toContainText("Visible to your devices");

  await page.getByLabel("This device's name").fill("Study laptop");
  await page.getByLabel("This device's name").blur();
  expect(await page.evaluate(() => localStorage.getItem("device-name"))).toBe("Study laptop");

  const start = (await invokedCalls(page)).find((c) => c.cmd === "plugin:lansync|start");
  expect(start?.args).toMatchObject({ name: "Mac" });
  expect((start?.args as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Home" }).first().click();
  await expect.poll(async () => (await invokedCalls(page)).some((c) => c.cmd === "plugin:lansync|stop")).toBe(true);
});
