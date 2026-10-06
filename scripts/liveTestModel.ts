/** Explicit inexpensive model selection for isolated provider smoke tests. */
import type { HostState } from "../src/host/hostState.js";
import type { HostStateSnapshot, ModelSelection } from "../src/shared/bridge.js";
import { effortDescriptor } from "../src/shared/modelOptions.js";

export function liveTestSelection(state: HostStateSnapshot): ModelSelection {
  const requested = process.env.T3_VSCODE_TEST_MODEL || "gpt-6-luna";
  for (const provider of state.providers.filter(provider => provider.enabled && provider.installed && provider.availability !== "unavailable")) {
    const model = provider.models.find(model => model.slug === requested);
    if (!model) continue;
    const selection = { instanceId: provider.instanceId, model: model.slug };
    const effort = effortDescriptor(model, selection);
    const low = effort?.options.find(option => option.id === "low");
    return { ...selection, ...(low && effort ? { options: [{ id: effort.id, value: low.id }] } : {}) };
  }
  throw new Error(`Live test model ${requested} is unavailable. Configure an inexpensive model and set T3_VSCODE_TEST_MODEL explicitly; no premium fallback is used.`);
}

export async function configureLiveTestModel(host: HostState, threadId?: string): Promise<void> {
  await host.setModel(threadId, liveTestSelection(host.snapshot()));
}
