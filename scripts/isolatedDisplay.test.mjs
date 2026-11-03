import assert from "node:assert/strict";
import { test } from "node:test";
import { isolatedDisplayEnvironment, startIsolatedDisplay } from "./isolatedDisplay.mjs";

test("GUI helpers share the private X display without inheriting the desktop Wayland socket", () => {
  const desktop = { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", PATH: "/usr/bin" };
  assert.deepEqual(isolatedDisplayEnvironment(":90", desktop), { DISPLAY: ":90", PATH: "/usr/bin" });
  assert.equal(desktop.WAYLAND_DISPLAY, "wayland-0", "Do not mutate the parent's environment");
});

test("an explicit display cannot point at the desktop, including screen aliases", async () => {
  const previous = process.env.DISPLAY;
  process.env.DISPLAY = ":0";
  try {
    for (const display of [":0", ":0.0", ":00.1", "localhost:0"])
      await assert.rejects(startIsolatedDisplay(display), /other than the desktop display/);
    const privateDisplay = await startIsolatedDisplay(":90");
    assert.equal(privateDisplay.display, ":90");
    privateDisplay.stop();
    process.env.DISPLAY = "localhost:0.0";
    await assert.rejects(startIsolatedDisplay(":0"), /other than the desktop display/);
  } finally {
    if (previous === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = previous;
  }
});
