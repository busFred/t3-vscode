import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowUpRightIcon, CopyIcon, GlobeIcon, InfoIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { ConnectionProblem } from "../../shared/connectionSetup";
import { useActions } from "../actions";
import { T3VSCodeIcon } from "./T3VSCodeIcon";

const install = "https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md";
const service = "https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md";
const updating = "https://github.com/pingdotgg/t3code/blob/main/docs/user/updating.md";

function Guide({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const run = useActions();
  return <button className="text-button setup-guide" onClick={() => { void run("openLink", { href }); }}>{children}<ArrowUpRightIcon size={12} aria-hidden="true" /></button>;
}

function Command({ text }: { readonly text: string }) {
  const run = useActions();
  return <div className="setup-command"><span aria-hidden="true">$</span><code>{text}</code><button className="icon-button" aria-label={`Copy ${text}`} onClick={() => { void run("copyText", { text }); }}><CopyIcon size={14} /></button></div>;
}

function Step({ number, title, children }: { readonly number: number; readonly title: string; readonly children: ReactNode }) {
  return <li className="setup-step"><span className="setup-step-number" aria-hidden="true">{number}</span><div><h2>{title}</h2>{children}</div></li>;
}

const copy: Record<ConnectionProblem["kind"], { title: string; description: string; notice: string; detail: string; stage: string }> = {
  "missing-runtime": { title: "Connect to T3 Code", description: "Start T3 Code on this computer to bring your conversations into VS Code.", notice: "No running server found", detail: "T3 may already be installed. A running server is needed to connect.", stage: "Find a local server" },
  "server-stopped": { title: "Your T3 server has stopped", description: "Start it again to reconnect to your conversations.", notice: "The last server is no longer running", detail: "The process recorded in this T3 directory has stopped.", stage: "Find a local server" },
  unreachable: { title: "T3 isn’t responding", description: "A local server is recorded, but its connection check did not complete.", notice: "Could not reach the recorded server", detail: "The server may still be starting or may need attention.", stage: "Check the server" },
  incompatible: { title: "This T3 server isn’t compatible", description: "T3 Code and this extension need compatible versions to connect.", notice: "The server uses a different connection protocol", detail: "Check the versions of T3 Code and T3 VSCode before retrying.", stage: "Check compatibility" },
  "cli-missing": { title: "T3 is running. Pairing needs attention.", description: "VS Code found your server but could not create its connection credential.", notice: "The t3 command could not be found", detail: "The command must be available to the VS Code extension host.", stage: "Pair with the server" },
  pairing: { title: "T3 is running. Pairing needs attention.", description: "VS Code found your server but could not create its connection credential.", notice: "Automatic pairing did not complete", detail: "Check the connection details, then try pairing again.", stage: "Pair with the server" },
  connection: { title: "Connection interrupted", description: "VS Code could not finish connecting to T3 Code.", notice: "The connection did not complete", detail: "Check the details below, then reconnect or pair again.", stage: "Connect to the server" },
};

export function ServerSetup({ state }: { readonly state: HostStateSnapshot }) {
  const run = useActions();
  const setup = state.connectionSetup;
  const kind = setup?.problem?.kind ?? (state.phase === "no-server" ? "missing-runtime" : "connection");
  const message = copy[kind];
  const pairing = kind === "pairing" || kind === "cli-missing";
  const stoppedService = kind === "server-stopped" && setup?.problem?.serviceManaged && setup.serviceSupported;
  const manualSetup = (kind === "missing-runtime" || kind === "server-stopped") && !stoppedService;
  const firstTime = kind === "missing-runtime" && !setup?.startupHint;

  return <main className="server-setup">
    <header className="setup-brand"><T3VSCodeIcon width={30} height={30} aria-hidden="true" /><strong>T3 VSCode</strong><span className="setup-connection-state">Not connected</span></header>
    <div className="setup-heading"><h1>{message.title}</h1><p>{message.description}</p></div>
    <div className="setup-notice"><InfoIcon size={17} aria-hidden="true" /><div><strong>{message.notice}</strong><p>{message.detail}</p><div className="setup-home"><span>T3 directory</span><code>{state.home}</code><button className="text-button" onClick={() => { void run("openSettings"); }}>Change</button></div></div></div>

    {manualSetup ? <>
      {firstTime ? <p className="setup-section-label">First-time setup</p> : null}
      <ol className="setup-steps">
        {firstTime ? <Step number={1} title="Install the T3 command-line tool"><p>Already have the <code>t3</code> command? Go to the next step.</p><Guide href={`${install}#command-line`}>Open installation guide</Guide></Step> : null}
        <Step number={firstTime ? 2 : 1} title={setup?.startupHint ? "Start your development server" : "Open T3 and set up a provider"}>
          {setup?.startupHint ? <p className="setup-startup-hint">{setup.startupHint}</p> : <><p>Run this in a terminal to start T3 and open its web app.</p>{setup ? <Command text={setup.startCommand} /> : <p>Start T3 using the data directory shown above.</p>}</>}
          <p>In T3, open <strong>Settings → Providers</strong> and connect a provider. Already set up? Just keep T3 running.</p>
          {setup ? <details className="setup-manual"><summary>{setup.startupHint ? "Start this server manually" : "Prefer to open the browser yourself?"}</summary><Command text={setup.serveCommand} /><p>Keep this terminal running and open the web address it prints. Complete provider setup there.</p></details> : null}
        </Step>
      </ol>
    </> : stoppedService ? <ol className="setup-steps">
      <Step number={1} title="Check the service"><p>The last server was managed by a background service. Check its status and log location.</p><Command text="t3 service status" /></Step>
      <Step number={2} title="Restart the installed service"><Command text="t3 service restart" /><p>If the status says it is not installed, use <code>t3 service install</code>. For other problems, follow its recovery instructions.</p><Guide href={`${service}#troubleshooting`}>Service troubleshooting</Guide></Step>
    </ol> : kind === "unreachable" ? <ol className="setup-steps">
      <Step number={1} title="Check T3’s output"><p>If you started T3 in a terminal, check that terminal for errors. For a background service, check its status and logs.</p>{setup?.serviceSupported ? <Command text="t3 service status" /> : null}</Step>
      <Step number={2} title="Check the data directory"><p>If T3 uses a different directory, update Connection settings and reload VS Code. Wait for startup to finish, then retry.</p></Step>
    </ol> : kind === "incompatible" ? <section className="setup-recovery"><h2>Check for compatible updates</h2><p>Update T3 Code and this extension as needed. Review the connection details for the server’s reported protocol.</p><Guide href={updating}>T3 update guide</Guide></section> : kind === "cli-missing" ? <ol className="setup-steps">
      <Step number={1} title="Check the T3 command"><p>Open a new terminal and check that this displays T3’s help.</p><Command text="t3 --help" /><Guide href={`${install}#command-line`}>Install the CLI or check its PATH</Guide></Step>
      <Step number={2} title="Restart VS Code, then pair again"><p>If you just installed T3 or updated your PATH, restart VS Code so it picks up the change.</p></Step>
    </ol> : null}

    {manualSetup && setup?.serviceSupported ? <details className="setup-service"><summary>Run in the background <span>Optional · Linux &amp; macOS</span></summary><div><p>Keep T3 running without an open terminal.</p><Command text="t3 service install" /><p>This installs and starts the service. If you started T3 in the terminal above, stop that foreground server before switching.</p><p>You can also install the service first and finish provider setup in T3’s web app afterward.</p><Guide href={service}>Background service guide</Guide></div></details> : null}

    <div className="setup-actions"><button className="btn primary" onClick={() => { void run(pairing ? "startPairing" : "reconnect"); }}><RefreshCwIcon size={14} />{pairing ? "Pair again" : "Retry connection"}</button><button className="btn" onClick={() => { void run("openSettings"); }}><SettingsIcon size={14} />Connection settings</button>{state.phase === "error" && !pairing ? <button className="text-button" onClick={() => { void run("startPairing"); }}>Pair again</button> : null}</div>
    <p className="setup-action-hint">Once T3 is running, retry here. VS Code pairs automatically and the sidebar opens Sessions.</p>
    <details className="setup-diagnostics" open={kind === "connection" || kind === "pairing"}><summary>Connection details</summary><dl><dt>Stage</dt><dd>{message.stage}</dd><dt>T3 directory</dt><dd><code>{state.home}</code></dd>{state.notice ? <><dt>Result</dt><dd>{state.notice}</dd></> : null}</dl><p>Using a custom directory? Set <code>t3-vscode.t3Home</code> to the same directory used by T3, then reload VS Code.</p></details>
    <footer>Connects to T3 Code on this computer. Remote servers aren’t supported yet. <Guide href={install}>Setup guide</Guide></footer>
  </main>;
}

/** Ready connections show Sessions immediately; provider setup never hides existing conversations. */
export function ProviderSetupNotice({ state }: { readonly state: HostStateSnapshot }) {
  const run = useActions();
  const [checking, setChecking] = useState(false);
  if (state.providers.some((provider) => provider.enabled && provider.installed && provider.availability !== "unavailable" && provider.models.length > 0)) return null;
  return <section className="provider-setup" aria-label="Provider setup"><strong>Connected. Set up a provider to chat.</strong><p>Open <strong>Settings → Providers</strong> in T3, connect a provider, then check again.</p><div><button className="text-button" onClick={() => { void run("openWebUi"); }}><GlobeIcon size={13} />Open T3 web app</button><button className="text-button" disabled={checking} onClick={() => { setChecking(true); void run("refreshUsage").finally(() => setChecking(false)); }}>{checking ? "Checking…" : "Check providers"}</button><Guide href={`${install}#providers`}>Provider setup guide</Guide></div></section>;
}
