/** A private X display for real VS Code checks, so they never take over the owner's desktop, focus or clipboard. */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const has = (command) => { try { execFileSync("which", [command], { stdio: "ignore" }); return true; } catch { return false; } };

export async function startIsolatedDisplay(requested) {
  if (requested) return { display: requested, stop() {} };
  const server = has("Xvfb") ? "Xvfb" : has("Xephyr") ? "Xephyr" : undefined;
  if (!server) throw new Error("No isolated X server: install Xvfb (sudo apt install xvfb), or set T3_VSCODE_TEST_DISPLAY to a display that is not your desktop.");
  let number = 90; while (existsSync(`/tmp/.X11-unix/X${number}`) || existsSync(`/tmp/.X${number}-lock`)) number += 1;
  const display = `:${number}`;
  const child = spawn(server, [display, "-screen", ...(server === "Xvfb" ? ["0", "1600x1000x24"] : ["1600x1000"]), "-nolisten", "tcp"], { stdio: "ignore" });
  for (let waited = 0; !existsSync(`/tmp/.X11-unix/X${number}`); waited += 100) {
    if (waited > 10_000) { child.kill(); throw new Error(`${server} did not start on ${display}`); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`Isolated display ${display} (${server}${server === "Xephyr" ? "; shown as one nested window. Install Xvfb to hide it" : ""})`);
  return { display, stop() { child.kill(); } };
}
