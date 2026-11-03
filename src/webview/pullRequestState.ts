import type { SourceControlSignInPrompt } from "@t3tools/contracts";
import type { PullRequestOperation, PullRequestResponse, PullRequestResponses } from "../shared/pullRequests.js";

export type PullRequestRequester = <K extends PullRequestOperation>(operation: K) => Promise<PullRequestResponse<K>>;
export interface PullRequestState {
  data: Partial<PullRequestResponses>;
  errors: Partial<Record<PullRequestOperation, string | undefined>>;
  loading: Partial<Record<PullRequestOperation, boolean>>;
  needsSignIn: boolean;
  signIn: "idle" | "starting" | "waiting" | "cancelling" | "failed";
  prompt?: SourceControlSignInPrompt | undefined;
}
/** A panel owns its requests; late replies from an old conversation or cancelled sign-in cannot update it. */
export class PullRequestStateController {
  state: PullRequestState = { data: {}, errors: {}, loading: {}, needsSignIn: false, signIn: "idle" };
  private disposed = false;
  private attempt = 0;
  private startRequest: ReturnType<PullRequestRequester> | null = null;
  private authenticationFailures = new Set<PullRequestOperation>();
  private versions = new Map<PullRequestOperation, number>();
  private readonly request: PullRequestRequester;
  private readonly changed: (state: PullRequestState) => void;
  constructor(request: PullRequestRequester, changed: (state: PullRequestState) => void) { this.request = request; this.changed = changed; }
  private update(patch: Partial<PullRequestState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.changed(this.state); } }
  async load<K extends PullRequestOperation>(operation: K) {
    const version = (this.versions.get(operation) ?? 0) + 1; this.versions.set(operation, version);
    this.update({ loading: { ...this.state.loading, [operation]: true } });
    try {
      const result = await this.request(operation);
      if (this.disposed || this.versions.get(operation) !== version) return;
      if ("error" in result && result.signInRequired) this.authenticationFailures.add(operation);
      else this.authenticationFailures.delete(operation);
      this.update({ needsSignIn: this.authenticationFailures.size > 0 });
      if ("error" in result) this.update({ errors: { ...this.state.errors, [operation]: result.error } });
      else this.update({ data: { ...this.state.data, [operation === "generateReviewGuide" ? "reviewGuide" : operation]: result.data }, errors: { ...this.state.errors, [operation]: undefined } });
    } catch (cause) {
      if (this.versions.get(operation) === version) this.update({ errors: { ...this.state.errors, [operation]: cause instanceof Error ? cause.message : String(cause) } });
    } finally { if (this.versions.get(operation) === version) this.update({ loading: { ...this.state.loading, [operation]: false } }); }
  }
  refresh() { return Promise.all([this.load("summary"), this.load("detail"), this.load("checks"), this.load("changeBreakdown"), this.load("reviewGuide"), this.load("appAccess")]); }
  async signIn() {
    const attempt = ++this.attempt;
    const active = () => !this.disposed && attempt === this.attempt;
    this.update({ signIn: "starting", prompt: undefined, errors: { ...this.state.errors, signInStart: undefined, signInWait: undefined, signInCancel: undefined } });
    try {
      const pending = this.request("signInStart"); this.startRequest = pending;
      const start = await pending;
      if (this.startRequest === pending) this.startRequest = null;
      if (!active()) return;
      if ("error" in start) { this.update({ signIn: "failed", errors: { ...this.state.errors, signInStart: start.error } }); return; }
      this.update({ signIn: "waiting", prompt: start.data });
      const finish = await this.request("signInWait");
      if (!active()) return;
      if ("error" in finish) this.update({ signIn: "failed", prompt: undefined, errors: { ...this.state.errors, signInWait: finish.error } });
      else { this.authenticationFailures.clear(); this.update({ signIn: "idle", prompt: undefined, needsSignIn: false }); await this.refresh(); }
    } catch (cause) { if (active()) this.update({ signIn: "failed", prompt: undefined, errors: { ...this.state.errors, signInWait: cause instanceof Error ? cause.message : String(cause) } }); }
  }
  async cancelSignIn() {
    ++this.attempt;
    this.update({ signIn: "cancelling", prompt: undefined });
    try {
      // Cancel after a pending start reaches the server, or it could create a flow after cancellation.
      await this.startRequest?.catch(() => undefined);
      this.startRequest = null;
      const result = await this.request("signInCancel");
      this.update({ signIn: "idle", ...("error" in result ? { errors: { ...this.state.errors, signInCancel: result.error } } : {}) });
    } catch (cause) { this.update({ signIn: "failed", errors: { ...this.state.errors, signInCancel: String(cause) } }); }
  }
  dispose() { if (this.state.signIn === "starting" || this.state.signIn === "waiting") void this.cancelSignIn(); this.disposed = true; ++this.attempt; }
}
