/** A private X display for real VS Code checks, so they never take over the owner's desktop, focus or clipboard. */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const has = (command) => { try { execFileSync("which", [command], { stdio: "ignore" }); return true; } catch { return false; } };

/** Every GUI child, including clipboard helpers, must share the private X display. */
export function isolatedDisplayEnvironment(display, base = process.env) {
  const environment = { ...base, DISPLAY: display };
  delete environment.WAYLAND_DISPLAY;
  return environment;
}

export async function startIsolatedDisplay(requested) {
  if (requested) {
    const numberOf = (display) => /:(\d+)(?:\.\d+)?$/.exec(display ?? "")?.[1];
    if (!/^:\d+(?:\.\d+)?$/.test(requested) || Number(numberOf(requested)) === Number(numberOf(process.env.DISPLAY)))
      throw new Error("T3_VSCODE_TEST_DISPLAY must name a local X display other than the desktop display.");
    return { display: requested, stop() {} };
  }
  const server = "Xvfb";
  if (!has(server)) throw new Error("No invisible X server: install Xvfb, or set T3_VSCODE_TEST_DISPLAY to an existing private X display. Xephyr is not started automatically because it opens a desktop window.");
  let number = 90; while (existsSync(`/tmp/.X11-unix/X${number}`) || existsSync(`/tmp/.X${number}-lock`)) number += 1;
  const display = `:${number}`;
  const child = spawn(server, [display, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"], { stdio: "ignore" });
  let launchError;
  child.on("error", error => { launchError = error; });
  for (let waited = 0; !existsSync(`/tmp/.X11-unix/X${number}`); waited += 100) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`${server} exited before starting on ${display}`);
    if (waited > 10_000) { child.kill(); throw new Error(`${server} did not start on ${display}`); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`Isolated display ${display} (${server}; invisible)`);
  return { display, stop() { child.kill(); } };
}
