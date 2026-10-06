import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMathMarkdown } from './mathMarkdown.js';

test('LaTeX delimiters render inline/display without rewriting fenced or inline code examples', () => {
  assert.equal(normalizeMathMarkdown(String.raw`Loss \(\mathcal{L}\) and \[\sum_i x_i\]`), 'Loss $\\mathcal{L}$ and \n$$\n\\sum_i x_i\n$$\n');
  for (const text of [String.raw`Code \`\(x\)\``, '\n````tex\n\\[x\\]\n````\n', '\n~~~python\nx="\\(y\\)"\n~~~\n', String.raw`Escaped \\(x\\)`, String.raw`Unfinished \(x`, '$\\sum_i x_i$']) assert.equal(normalizeMathMarkdown(text), text);
});
