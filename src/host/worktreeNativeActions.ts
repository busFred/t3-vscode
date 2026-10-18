import type { WorktreeCoordinator } from './worktrees';
import type { TurnDiff, TurnDiffFile } from './turnDiff';
import type { ReviewDiffFileContentsResult } from '@t3tools/contracts';

export interface WorktreeNativePort {
  confirm(message: string, detail: string, action: string): PromiseLike<boolean>;
  openWindow(path: string): PromiseLike<unknown>;
  terminal(command: { executable: string; args: string[]; cwd: string; title: string; env: Record<string, string> }): PromiseLike<unknown>;
  openDiff(diff: TurnDiff, load: (file: TurnDiffFile) => Promise<ReviewDiffFileContentsResult>, file?: string): Promise<void>;
}
export type WorktreeNativeCoordinator = Pick<WorktreeCoordinator, 'snapshot' | 'requireCheckout' | 'command' | 'cancel' | 'retry' | 'prepareCheckout' | 'restore' | 'removalDetails' | 'remove' | 'review' | 'diffFile' | 'apply' | 'gitAction'>;
function text(params: Record<string, unknown>, field: string, optional = false): string {
  const value = params[field];
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || !value || value.includes('\0') || value.length > 4096) throw new Error(`Invalid worktree ${field}`);
  return value;
}
/** Native confirmations operate on host-validated checkout identities, never renderer commands. */
export async function runWorktreeNativeAction(coordinator: WorktreeNativeCoordinator, params: Record<string, unknown>, port: WorktreeNativePort,
  hooks: { retry?: (id: string) => Promise<unknown> } = {}): Promise<void> {
  const projectId = text(params, 'projectId'); const action = text(params, 'action');
  if (action === 'cancel' || action === 'retry') {
    const id = text(params, 'preparationId');
    if (!coordinator.snapshot().preparations.some((preparation) => preparation.id === id && preparation.projectId === projectId)) throw new Error('This preparation is not available in the selected project');
    if (action === 'cancel') coordinator.cancel(id);
    else await (hooks.retry ? hooks.retry(id) : coordinator.retry(id));
    return;
  }
  const path = text(params, 'path');
  const { tree } = await coordinator.requireCheckout(projectId, path, action === 'restore');
  const checkout = tree.path;
  switch (action) {
    case 'open': await port.openWindow(checkout); break;
    case 'terminal': case 'runAction':
      await port.terminal(await coordinator.command(projectId, checkout, action === 'runAction' ? text(params, 'actionId') : undefined)); break;
    case 'prepare': await coordinator.prepareCheckout(projectId, checkout); break;
    case 'restore': await coordinator.restore(projectId, checkout); break;
    case 'remove': {
      const details = await coordinator.removalDetails(projectId, checkout);
      const environment = details.environment;
      const detail = [
        `Checkout: ${details.tree.path}`,
        `Branch: ${details.tree.branch || '(detached)'}; branch and conversation history are retained.`,
        environment ? `Managed Python environment: ${environment.target} (${environment.location}). This environment will also be removed.` : 'No managed Python environment is recorded.',
        details.ignored ? 'Ignored files are present and will be permanently deleted with the checkout.' : 'No ignored files were found.',
      ].join('\n\n');
      if (await port.confirm('Remove this worktree and its managed environment?', detail, 'Remove worktree')) await coordinator.remove(projectId, checkout);
      break;
    }
    case 'review': {
      const baseRef = text(params, 'baseRef', true);
      const review = await coordinator.review(projectId, checkout, baseRef || undefined);
      const diff: TurnDiff = { threadId: `worktree:${projectId}:${checkout}`, title: review.branch || checkout, displayLabel: 'Worktree changes', turnNumber: 0, cwd: checkout, baseRef: review.baseRef, headRef: 'working checkout',
        files: review.files.map((file) => ({ ...file, oldPath: file.path, newPath: file.path, changeType: 'change' })) };
      await port.openDiff(diff, async (file) => {
        if (!diff.files.includes(file)) throw new Error('File is not part of this worktree review');
        const contents = await coordinator.diffFile(projectId, checkout, review.baseRef, file.newPath);
        if (contents.binary) throw new Error('This file is binary and cannot be displayed in a text diff');
        return { oldContents: contents.before, newContents: contents.after };
      }, text(params, 'file', true) || undefined);
      break;
    }
    case 'apply': {
      const destination = text(params, 'destination');
      const target = await coordinator.requireCheckout(projectId, destination);
      if (target.tree.path === checkout) throw new Error('Source and destination must be different checkouts');
      if (!Array.isArray(params.files) || !params.files.length || params.files.length > 500 || params.files.some((file) => typeof file !== 'string' || !file || file.includes('\0') || file.length > 4096)) throw new Error('Select between 1 and 500 changed files');
      const files = [...new Set(params.files as string[])];
      const review = await coordinator.review(projectId, checkout, text(params, 'baseRef', true) || undefined);
      if (files.some((file) => !review.files.some((entry) => entry.path === file))) throw new Error('A selected file is no longer part of the worktree changes; refresh the review');
      const detail = `From: ${checkout}\nTo: ${target.tree.path}\n\n${files.join('\n')}\n\nDestination edits remain uncommitted. Conflicting changes stop the transfer.`;
      if (await port.confirm(`Apply ${files.length} selected file${files.length === 1 ? '' : 's'} to this checkout?`, detail, 'Apply files')) await coordinator.apply(projectId, checkout, target.tree.path, files, review.baseRef);
      break;
    }
    case 'git': {
      const operation = text(params, 'operation');
      if (!['commit', 'push', 'create_pr', 'commit_push', 'commit_push_pr'].includes(operation)) throw new Error('Invalid Git operation');
      const commitMessage = text(params, 'commitMessage', true);
      if (operation.startsWith('commit') && !commitMessage.trim()) throw new Error('Enter a commit message');
      if (await port.confirm(`Run ${operation.replaceAll('_', ' ')}?`, `Checkout: ${checkout}${commitMessage ? `\n\nCommit message: ${commitMessage}` : ''}`, 'Continue')) await coordinator.gitAction(projectId, checkout, operation, commitMessage || undefined);
      break;
    }
    default: throw new Error('Unsupported worktree action');
  }
}
