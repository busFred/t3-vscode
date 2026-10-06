import { CopyIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import { useActions } from "../actions";
import { T3VSCodeIcon } from "./T3VSCodeIcon";

const install = "https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md";
const service = "https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md";
export function ServerSetup({ state }: { readonly state: HostStateSnapshot }) {
  const run = useActions();
  const link = (href: string, label: string) => <button className="text-button" aria-label={label} onClick={() => { void run("openLink", { href }); }}>{label} <span aria-hidden="true">↗</span></button>;
  const command = (text: string) => <div className="setup-command"><code>{text}</code><button className="icon-button" aria-label={`Copy ${text}`} onClick={() => { void run("copyText", { text }); }}><CopyIcon size={14} /></button></div>;
  return <main className="server-setup">
    <header><T3VSCodeIcon width={30} height={30} /><h1>T3 VSCode</h1></header>
    <p>Connect to a local T3 Code server to use your conversations here.</p>
    <section><h2>Don’t have T3 Code installed?</h2><p>Install the T3 Code CLI on this computer.</p>{link(install, "Installation guide")}</section>
    <section><h2>Server isn’t running?</h2><p>Run it as a background service on Linux or macOS.</p>{command("t3 service install")}{link(service, "Background service instructions")}<p>Prefer to run it manually? Keep this command running in a terminal.</p>{command("t3 serve")}{link(`${install}#command-line`, "Manual server instructions")}</section>
    <section><h2>Using a remote T3 server?</h2><p>Remote servers aren’t supported by T3 VSCode yet. Use a local server on this computer.</p></section>
    <div className="setup-actions"><button className="btn primary" onClick={() => { void run("reconnect"); }}><RefreshCwIcon size={14} />Retry connection</button><button className="btn" onClick={() => { void run("openSettings"); }}><SettingsIcon size={14} />Settings</button></div>
    {state.notice ? <details className="setup-diagnostics"><summary>Connection details</summary><p>{state.notice}</p></details> : null}
  </main>;
}
