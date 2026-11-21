/** T3 markdown/media presentation, with native file and external-link actions. */
import { Fragment, createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathMarkdown } from "../../shared/mathMarkdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { collectAssistantCitations, parseAssistantCitationHref } from "../../shared/messageCitations.js";
import { useActions } from "../actions";
import { AssistantCitationLink, AssistantCitationNumbersContext, citationKey } from "./AssistantCitationLink";
import { ChatMedia } from "./ChatMedia";
import { MermaidVisual } from "./MermaidVisual";
import { CodeBlock } from "./CodeBlock";
import { codeBlockLanguage } from "../../shared/codeBlock";
import type { ChatAssetSource } from "../../shared/chatVisuals";
import { OrchestrationMessageContext, type ChatAttachment, type ResponseContextRecord, type ThreadContextRecord } from "@t3tools/contracts";
import { ReplyIcon, MessagesSquareIcon } from "lucide-react";
import { parseComposerContextHref } from "@t3tools/shared/composerContextReferences";
import * as Schema from "effect/Schema";
import { InlineAttachment } from "./InlineAttachment";
import { previewEquation } from "./EquationPreview";
import { splitMarkdownBlocks } from "../markdownBlocks";
const EMPTY_ATTACHMENTS: ReadonlyArray<Pick<ChatAttachment, "id" | "name" | "mimeType" | "sizeBytes">> = [];
const sanitizeSchema = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), "video", "audio", "source", "u"],
  attributes: { ...defaultSchema.attributes, code: [["className", /^language-./, "math-inline", "math-display"]], video: ["src", "controls", "poster"], audio: ["src", "controls"], source: ["src", "type"] },
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href ?? []), "file", "t3-citation", "t3-context"], src: [...(defaultSchema.protocols?.src ?? []), "file", "data", "t3-context"] } };
type MarkdownScope = { readonly threadId: string; readonly assetSource: ChatAssetSource | undefined; readonly streaming: boolean; readonly inlineAttachment: (href: string | undefined) => ReactNode };
const MarkdownScopeContext = createContext<MarkdownScope>({ threadId: "", assetSource: undefined, streaming: false, inlineAttachment: () => null });
// Element overrides must keep stable component identities. Recreating them on every
// render remounts media/diagrams, whose brief loading placeholders were measured by
// the virtualized transcript and left later rows drawn over the response.
const components: Components = {
  span: ({ node: _node, className, children, ...props }) => className?.split(" ").includes("katex") ? <span {...props} className={className} tabIndex={0} role="math" aria-label="Preview equation" title="Click to preview; right-click to copy" onClick={(event) => previewEquation(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); previewEquation(event.currentTarget); } }}>{children}</span> : <span {...props} className={className}>{children}</span>,
  a: function MarkdownLink({ href, children }) {
    const run = useActions(); const { threadId, inlineAttachment } = useContext(MarkdownScopeContext);
    const citation = href ? parseAssistantCitationHref(href) : null;
    if (citation) return <AssistantCitationLink citation={citation} />;
    if (href?.startsWith("t3-context:")) return inlineAttachment(href) ?? <span>{children}</span>;
    // Web links are left to the webview host, which prompts before opening. Calling openExternal as
    // well opened the browser immediately, racing that prompt and ignoring its answer.
    if (href && /^https?:\/\//i.test(href)) return <a href={href}>{children}</a>;
    return <a href={href} onClick={(event) => { event.preventDefault(); if (href) void run("openLink", { href, threadId }); }}>{children}</a>;
  },
  img: function MarkdownImage({ alt, src }) {
    const { threadId, assetSource, inlineAttachment } = useContext(MarkdownScopeContext);
    return src?.startsWith("t3-context:") ? inlineAttachment(src) ?? <span>{alt || "Image"}</span> : src ? <ChatMedia src={src} alt={alt || "Image"} threadId={threadId} source={assetSource} /> : <span>{alt}</span>;
  },
  video: function MarkdownVideo({ src }) { const { threadId, assetSource } = useContext(MarkdownScopeContext); return src ? <ChatMedia src={src} alt="Video" kind="video" threadId={threadId} source={assetSource} /> : null; },
  audio: function MarkdownAudio({ src }) { const { threadId, assetSource } = useContext(MarkdownScopeContext); return src ? <ChatMedia src={src} alt="Audio" kind="audio" threadId={threadId} source={assetSource} /> : null; },
  pre: function MarkdownPre({ children, node }) {
    const { streaming } = useContext(MarkdownScopeContext);
    const code = node?.children[0];
    if (code?.type === "element" && code.tagName === "code" && Array.isArray(code.properties.className) && code.properties.className.includes("language-mermaid")) {
      const diagram = code.children.map((child) => child.type === "text" ? child.value : "").join("");
      return <MermaidVisual source={diagram} streaming={streaming} />;
    }
    if (code?.type === "element" && code.tagName === "code") {
      const language = codeBlockLanguage(code.properties.className);
      return <CodeBlock code={code.children.map((child) => child.type === "text" ? child.value : "").join("")} {...(language ? { language } : {})} />;
    }
    return <pre>{children}</pre>;
  },
};
export const ChatMarkdown = memo(function ChatMarkdown({ text, threadId, source, assetSource, streaming = false, context, attachments = EMPTY_ATTACHMENTS }: {
  text: string; threadId: string; source?: { environmentId: string; threadId: string; messageId: string; author?: "user" }; assetSource?: ChatAssetSource; streaming?: boolean; context?: unknown; attachments?: ReadonlyArray<Pick<ChatAttachment, "id" | "name" | "mimeType" | "sizeBytes">>;
}) {
  const parsedContext = useMemo(() => { try { return context ? Schema.decodeUnknownSync(OrchestrationMessageContext)(context) : undefined; } catch { return undefined; } }, [context]);
  const citationNumbers = useMemo(() => { const numbers = new Map<string, number>(); for (const { citation } of collectAssistantCitations(text)) { const key = citationKey(citation); if (!numbers.has(key)) numbers.set(key, numbers.size + 1); } return numbers; }, [text]);
  const inlineAttachment = useCallback((href: string | undefined) => {
    const reference = href ? parseComposerContextHref(href) : null;
    const record = reference ? parsedContext?.records.find((record) => record.contextId === reference.contextId && record.kind === reference.kind) : undefined;
    const attachment = record && "attachmentId" in record && typeof record.attachmentId === "string" ? attachments.find((attachment) => attachment.id === record.attachmentId) : undefined;
    if (record?.kind === "thread" && "threadId" in record) return <SideChatReference record={record as ThreadContextRecord} />;
    if (record?.kind === "response" && "citation" in record) return <ResponseReplyReference record={record as ResponseContextRecord} />;
    return attachment ? <InlineAttachment attachment={attachment} threadId={threadId} source={assetSource} /> : null;
  }, [parsedContext, attachments, threadId, assetSource]);
  const scope = useMemo(() => ({ threadId, assetSource, streaming, inlineAttachment }), [threadId, assetSource, streaming, inlineAttachment]);
  const blocks = useMemo(() => splitMarkdownBlocks(normalizeMathMarkdown(text)), [text]);
  const liveTail = blocks[blocks.length - 1] ?? "";
  const shownTail = useThrottledTail(liveTail, streaming === true && liveTail.length > TAIL_THROTTLE_BYTES);
  return <MarkdownScopeContext.Provider value={scope}><AssistantCitationNumbersContext.Provider value={citationNumbers}><div className="markdown" data-citation-author={source?.author} data-assistant-citation-source={source?.messageId} data-assistant-citation-environment={source?.environmentId} data-assistant-citation-thread={source?.threadId}>{blocks.map((block, index) => <Fragment key={index}>{index ? "\n" : null}<MarkdownBlock text={index === blocks.length - 1 ? shownTail : block} /></Fragment>)}</div></AssistantCitationNumbersContext.Provider></MarkdownScopeContext.Provider>;
});

function SideChatReference({ record }: { readonly record: ThreadContextRecord }) {
  const run = useActions();
  return <button type="button" className="reply-reference" title={record.title} onClick={() => { void run("openSessionTab", { threadId: record.threadId, environmentId: record.environmentId }); }}>
    <MessagesSquareIcon size={12} aria-hidden="true" /><span className="reply-reference-who">Side chat:</span><span className="reply-reference-text">{record.title}</span>
  </button>;
}

/** The response a sent message replies to (T3 0.1.10), whichever client sent it; opens that response like a quote's source. */
function ResponseReplyReference({ record }: { readonly record: ResponseContextRecord }) {
  const who = record.subagents?.length ? `Replying to ${record.subagents.map((subagent) => subagent.title).join(", ")}` : "Replying to";
  const opening = record.citation.text.replace(/\s+/g, " ").trim();
  return <button type="button" className="reply-reference" title={`${record.citation.text}\n\nOpen the response this replies to`} aria-label={`${who}: ${opening}. Open the response`}
    onClick={() => window.dispatchEvent(new CustomEvent("t3-open-citation", { detail: record.citation }))}>
    <ReplyIcon size={12} aria-hidden="true" /><span className="reply-reference-who">{who}</span><span className="reply-reference-text">{opening}</span>
  </button>;
}

/**
 * Hold a streaming reply's trailing block back to a fixed cadence once it is long.
 *
 * Earlier blocks are split off and memoized, but from the first list, quote, indented or HTML line
 * onwards the remainder stays one block, which is re-parsed in full on every update: measured at
 * about 7 ms at 1 KB and 40-55 ms at 8 KB, growing as the reply does.
 *
 * Only the tail's text lags, never the split rules or the block keys that keep media and diagrams
 * mounted. When streaming stops the live text is returned directly, so the finished reply is always
 * complete and never waits on a timer.
 */
const TAIL_THROTTLE_MS = 120;
const TAIL_THROTTLE_BYTES = 2048;
function useThrottledTail(text: string, throttle: boolean): string {
  const [shown, setShown] = useState(text);
  const lastAt = useRef(0);
  const throttling = useRef(false);
  useEffect(() => {
    // A tail that splits into a new paragraph drops under the threshold and stops being throttled.
    // Without resetting, the next tail to cross it would briefly render the previous block's text.
    if (!throttle) { throttling.current = false; return; }
    if (!throttling.current) { throttling.current = true; lastAt.current = Date.now(); setShown(text); return; }
    const wait = TAIL_THROTTLE_MS - (Date.now() - lastAt.current);
    if (wait <= 0) { lastAt.current = Date.now(); setShown(text); return; }
    const timer = setTimeout(() => { lastAt.current = Date.now(); setShown(text); }, wait);
    return () => clearTimeout(timer);
  }, [text, throttle]);
  return throttle ? shown : text;
}

const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], [rehypeKatex, { strict: "ignore", trust: false, throwOnError: false }]]}
    urlTransform={(url, key) => url.startsWith("file:") || url.startsWith("t3-citation:") || url.startsWith("t3-context:") || (key === "src" && /^data:(image|video|audio)\//i.test(url)) ? url : defaultUrlTransform(url)}
    components={components}>{text}</ReactMarkdown>;
});
