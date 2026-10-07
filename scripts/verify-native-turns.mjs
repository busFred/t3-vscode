/** Actual checkpoint diff and queue/steer round-trip on an isolated inexpensive provider. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
export async function verifyNativeTurns({ home, evidence, workbench, panel, sidebar, runCommand }) {
    const setMessage = async (text) => {
      await panel.evaluate(`(() => { const input = document.querySelector('textarea[aria-label="Message"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    };
    const sendMessage = async (text) => { await setMessage(text); await panel.wait('!document.querySelector(".send-button").disabled'); await panel.evaluate('document.querySelector(".send-button").click()'); };
    const complete = async (marker) => {
      // The citation checks deliberately leave an older response selected.
      // Resume Latest before checking new responses in the virtualized DOM.
      await panel.evaluate('document.querySelector(".message-nav-latest")?.click()');
      await panel.wait(`[...document.querySelectorAll('.assistant-message')].some(node => node.textContent.includes(${JSON.stringify(marker)}) && !node.querySelector('.streaming-label')) && !document.querySelector('.stop-button')`, 150_000);
    };
    await runCommand('T3 VSCode: Account & Usage');
    await sidebar.wait('document.querySelector(".account-usage").open');
    await setMessage("/"); await panel.wait('document.querySelector(".composer-suggestions [role=option]")');
    await workbench.screenshot({ path: join(evidence, "edh-slash-commands.png") });
    await setMessage("Inspect @example"); await panel.wait('document.querySelector(".composer-suggestions")?.textContent.includes("example.ts")');
    await workbench.screenshot({ path: join(evidence, "edh-file-suggestions.png") });
    await setMessage("");
    await sendMessage("In this temporary workspace, create roundtrip.txt containing exactly TURN-TWO followed by a newline. Use a file editing tool. Do not commit. Reply FIRST-DIFF-DONE after creating it.");
    await complete("FIRST-DIFF-DONE");
    await panel.wait('[...document.querySelectorAll(".turn-changes")].some(node => node.textContent.includes("roundtrip.txt"))');
    const firstCheckpoint = await panel.evaluate('document.querySelectorAll(".turn-changes").item(document.querySelectorAll(".turn-changes").length - 1).dataset.checkpointId');
    await sendMessage("Append exactly TURN-THREE followed by a newline to roundtrip.txt, keeping its existing TURN-TWO line unchanged. Use a file editing tool. Do not commit. Reply SECOND-DIFF-DONE after editing it.");
    await complete("SECOND-DIFF-DONE");
    await panel.wait(`document.querySelectorAll('.turn-changes').item(document.querySelectorAll('.turn-changes').length - 1)?.dataset.checkpointId !== ${JSON.stringify(firstCheckpoint)}`);
    const secondCheckpoint = await panel.evaluate('document.querySelectorAll(".turn-changes").item(document.querySelectorAll(".turn-changes").length - 1).dataset.checkpointId');
    assert.equal(await readFile(join(home, "workspace/roundtrip.txt"), "utf8"), "TURN-TWO\nTURN-THREE\n");
    const openSavedDiff = async (checkpoint, oldText, newText) => {
      await panel.evaluate(`(() => { const card = document.querySelector('.turn-changes[data-checkpoint-id="${checkpoint}"]'); const details = card.querySelector('details'); details.open = true; card.querySelector('[aria-label="Open turn diff: roundtrip.txt"]').click(); })()`);
      const diff = workbench.locator('.monaco-diff-editor').filter({ visible: true }).first(); await diff.waitFor();
      const original = diff.locator('.editor.original .view-lines'); const modified = diff.locator('.editor.modified .view-lines');
      // The preview tab can reuse the existing diff widget while loading new models.
      await workbench.waitForFunction(({ oldText, newText }) => {
        const diff = [...document.querySelectorAll('.monaco-diff-editor')].find(node => node.getBoundingClientRect().height > 0);
        const before = diff?.querySelector('.editor.original .view-lines')?.textContent;
        const after = diff?.querySelector('.editor.modified .view-lines')?.textContent;
        return before !== undefined && after?.includes(newText) && before.includes(oldText) && (oldText || !before.includes('TURN-TWO')) && (newText !== 'TURN-TWO' || !after.includes('TURN-THREE'));
      }, { oldText, newText });
      const before = (await original.textContent()).replaceAll('\u00a0', ''); const after = (await modified.textContent()).replaceAll('\u00a0', '');
      assert.ok(before.includes(oldText)); assert.ok(after.includes(newText));
      if (!oldText) assert.ok(!before.includes('TURN-TWO'));
      if (newText === 'TURN-TWO') assert.ok(!after.includes('TURN-THREE'), 'Earlier saved diffs must not read the current working file');
    };
    await openSavedDiff(secondCheckpoint, "TURN-TWO", "TURN-THREE");
    await workbench.screenshot({ path: join(evidence, "edh-adjacent-turn-diff.png") });
    await openSavedDiff(firstCheckpoint, "", "TURN-TWO");
    await workbench.screenshot({ path: join(evidence, "edh-earlier-turn-diff.png") });
    console.log("PASS: native saved-turn diff compares adjacent checkpoints; an earlier creation diff remains unchanged after the next turn edits the working file");
    await runCommand('T3 VSCode: Open Chat in Editor Tab');
    await sendMessage("This is a Queue/Steer integration check in a disposable workspace. First use update_plan to record three steps: Start the integration check (completed), Wait for a follow-up (in_progress), Finish verification (pending). Then use your terminal tool to run sleep 20. Wait for that command to finish before responding. Include any follow-up marker in your final reply and mark all plan steps complete.");
    await panel.wait('document.querySelector(".tasks-section") && document.querySelector("textarea[aria-label=\\"Message\\"]").title.includes("Enter to queue")', 90_000);
    assert.equal(await panel.evaluate('document.querySelectorAll("select[aria-label=\\"Follow-up delivery\\"]").length'), 0);
    await setMessage("Include QUEUE-STEER-OK in your final response.");
    await panel.wait('!document.querySelector(".send-button").disabled');
    await panel.evaluate(`document.querySelector('textarea[aria-label="Message"]').focus()`);
    await workbench.keyboard.press('Enter');
    await panel.wait('document.querySelector(".queued-preview")?.textContent.includes("QUEUE-STEER-OK")');
    await workbench.screenshot({ path: join(evidence, "edh-queue-and-tasks.png") });
    await panel.wait('!document.querySelector("[aria-label=\\"Steer with queued message\\"]").disabled');
    await panel.evaluate('document.querySelector("[aria-label=\\"Steer with queued message\\"]").click()');
    await panel.wait('!document.querySelector(".queued-message")');
    await setMessage("Also include CTRL-STEER-OK in your final response.");
    await panel.wait('!document.querySelector(".send-button").disabled');
    await panel.evaluate(`document.querySelector('textarea[aria-label="Message"]').focus()`);
    await workbench.keyboard.press('Control+Enter');
    await panel.wait('document.querySelector("textarea[aria-label=\\"Message\\"]").value === "" && !document.querySelector(".queued-message")');
    await complete("QUEUE-STEER-OK");
    await complete("CTRL-STEER-OK");
    await panel.wait('!document.querySelector(".tasks-section")');
    await workbench.screenshot({ path: join(evidence, "edh-queue-steer-finished.png") });
    console.log("PASS: real native command/file suggestions and Usage; Enter queues, queue-list promotion and Ctrl+Enter both steer the provider; current-run task progress clears at completion");
}
