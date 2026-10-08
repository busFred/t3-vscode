import assert from "node:assert/strict";

/** Exercise setup inside the built UI with fixture snapshots and existing bridge intents. */
export async function verifyOnboarding(page, evidence) {
  const original = await page.evaluate(() => ({ state: window.__state, surface: document.body.dataset.surface, style: document.documentElement.getAttribute("style") }));
  const viewport = page.viewportSize();
  const normal = { startCommand: "t3", serveCommand: "t3 serve", serviceSupported: true };
  const isolated = { startCommand: "t3 --base-dir '/tmp/t3-vscode-onboarding-fixture'", serveCommand: "t3 serve --base-dir '/tmp/t3-vscode-onboarding-fixture'", serviceSupported: false };
  const replace = (patch) => page.evaluate((value) => window.__replace(value), patch);
  const request = (method, predicate = {}) => page.waitForFunction(({ method, predicate }) => window.__requests.some((entry) => entry.method === method && Object.entries(predicate).every(([key, value]) => entry.params?.[key] === value)), { method, predicate });
  const theme = (dark) => page.evaluate((dark) => {
    const palette = dark
      ? { background: "#1f1f1f", foreground: "#e9e9eb", description: "#a8adb6", surface: "#252526", border: "#454545", link: "#85bffa" }
      : { background: "#fafafa", foreground: "#23252a", description: "#626872", surface: "#f0f1f3", border: "#dedfe3", link: "#1769aa" };
    for (const [name, value] of Object.entries({
      "editor-background": palette.background, "editor-foreground": palette.foreground, "foreground": palette.foreground,
      "descriptionForeground": palette.description, "sideBar-background": palette.surface, "sideBar-foreground": palette.foreground,
      "editorWidget-background": palette.background, "panel-border": palette.border, "input-border": palette.border,
      "input-background": palette.background, "input-foreground": palette.foreground, "textCodeBlock-background": palette.surface,
      "textLink-foreground": palette.link, "button-background": "#1769aa", "button-foreground": "#fff", "editorWarning-foreground": dark ? "#e7ba79" : "#966018",
    })) document.documentElement.style.setProperty(`--vscode-${name}`, value);
  }, dark);
  try {
    await page.setViewportSize({ width: 360, height: 900 });
    await theme(true);
    await replace({ phase: "no-server", home: "/tmp/t3-vscode-onboarding-fixture", notice: "No runtime file was found.", connectionSetup: { ...isolated, problem: { kind: "missing-runtime" } } });
    await page.getByRole("heading", { name: "Connect to T3 Code", exact: true }).waitFor();
    assert.equal(await page.locator('.setup-service').count(), 0, "An isolated home must not suggest installing the normal service.");
    await page.getByRole("button", { name: "Open installation guide", exact: true }).click();
    await request("openLink", { href: "https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md#command-line" });
    await page.getByRole("button", { name: `Copy ${isolated.startCommand}`, exact: true }).click();
    await request("copyText", { text: isolated.startCommand });
    await page.locator('.setup-manual summary').click();
    await page.getByRole("button", { name: `Copy ${isolated.serveCommand}`, exact: true }).click();
    await request("copyText", { text: isolated.serveCommand });
    await page.getByRole("button", { name: "Connection settings", exact: true }).click();
    await request("openSettings");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await replace({ home: "/home/fixture/.t3", connectionSetup: { ...normal, problem: { kind: "missing-runtime" } } });
    await page.locator('.setup-service summary').click();
    await page.getByRole("button", { name: "Copy t3 service install", exact: true }).click();
    await request("copyText", { text: "t3 service install" });
    assert.ok((await page.locator('.setup-service').textContent()).includes("install the service first"));
    await page.locator('.setup-service summary').click();
    if (await page.locator('.setup-manual').evaluate((node) => node.open)) await page.locator('.setup-manual summary').click();
    await page.locator('.server-setup').evaluate((node) => { node.scrollTop = 0; });
    await page.screenshot({ path: `${evidence}/missing-server-setup.png` });
    await theme(false);
    await page.screenshot({ path: `${evidence}/missing-server-setup-light.png` });
    await theme(true);

    const cases = [
      ["server-stopped", "Your T3 server has stopped", "no-server"],
      ["unreachable", "T3 isn’t responding", "no-server"],
      ["incompatible", "This T3 server isn’t compatible", "no-server"],
      ["cli-missing", "T3 is running. Pairing needs attention.", "error"],
      ["pairing", "T3 is running. Pairing needs attention.", "error"],
      ["connection", "Connection interrupted", "error"],
    ];
    for (const [kind, heading, phase] of cases) {
      await replace({ phase, notice: `Fixture: ${kind}`, connectionSetup: { ...normal, problem: { kind, serviceManaged: true } } });
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      assert.doesNotMatch(await page.locator('.server-setup').textContent(), /t3 service start/);
      if (kind === "server-stopped") await page.getByRole("button", { name: "Copy t3 service restart", exact: true }).waitFor();
      if (kind === "cli-missing") {
        await page.getByRole("button", { name: "Copy t3 --help", exact: true }).waitFor();
        await page.getByRole("button", { name: "Pair again", exact: true }).click();
        await request("startPairing");
      }
    }

    const hint = "Run T3 VSCode: start isolated server in the original VS Code window.";
    await replace({ phase: "no-server", home: "/tmp/t3-vscode-onboarding-fixture", connectionSetup: { ...isolated, startupHint: hint, problem: { kind: "missing-runtime" } } });
    await page.getByText(hint, { exact: true }).waitFor();
    assert.equal(await page.locator('.setup-service').count(), 0);
    await page.evaluate(() => { document.body.dataset.surface = "sidebar"; window.__replace({}); });
    await page.getByRole("button", { name: "Retry connection", exact: true }).click();
    await request("reconnect");
    await replace({ phase: "pairing" });
    await page.getByText("Pairing with T3 Code…", { exact: true }).waitFor();
    await page.evaluate(() => window.__replace({ projects: window.__initialForWide.projects, threads: window.__initialForWide.threads, workspaceRoots: [] }));
    await replace({ phase: "ready", notice: undefined, connectionSetup: isolated, providers: [] });
    await page.getByRole("complementary", { name: "Sessions", exact: true }).waitFor();
    assert.equal(await page.locator('.server-setup').count(), 0);
    assert.equal(await page.getByRole("button", { name: "Open sessions", exact: true }).count(), 0, "There must be no success screen or extra navigation click.");
    await page.getByRole("region", { name: "Provider setup", exact: true }).waitFor();
    assert.equal(await page.locator('[data-thread-id="thread-one"]').isVisible(), true, "Provider setup must leave existing sessions accessible.");
    await page.screenshot({ path: `${evidence}/onboarding-provider-setup.png` });
    await page.getByRole("button", { name: "Open T3 web app", exact: true }).click();
    await request("openWebUi");
    await page.getByRole("button", { name: "Check providers", exact: true }).click();
    await request("refreshUsage");
    await page.evaluate(() => window.__replace({ providers: window.__initialForWide.providers }));
    await page.getByRole("region", { name: "Provider setup", exact: true }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("complementary", { name: "Sessions", exact: true }).isVisible(), true);
    await page.screenshot({ path: `${evidence}/onboarding-connected-sessions.png` });
  } finally {
    await page.evaluate(({ state, surface, style }) => {
      document.body.dataset.surface = surface;
      if (style === null) document.documentElement.removeAttribute("style"); else document.documentElement.setAttribute("style", style);
      window.__replace(state);
    }, original);
    if (viewport) await page.setViewportSize(viewport);
  }
  console.log("PASS: accurate onboarding states, scoped copyable commands, automatic Sessions, and non-blocking provider setup.");
}
