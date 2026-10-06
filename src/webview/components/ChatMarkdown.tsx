/** T3 markdown/media presentation, with native file and external-link actions. */
import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathMarkdown } from "../../shared/mathMarkdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import { useActions } from "../actions";
import { AssistantCitationLink } from "./AssistantCitationLink";
import { ChatMedia } from "./ChatMedia";
import { MermaidVisual } from "./MermaidVisual";
import type { ChatAssetSource } from "../../shared/chatVisuals";
const sanitizeSchema = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), "video", "audio", "source"],
  attributes: { ...defaultSchema.attributes, code: [["className", /^language-./, "math-inline", "math-display"]], video: ["src", "controls", "poster"], audio: ["src", "controls"], source: ["src", "type"] },
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href ?? []), "file", "t3-citation"], src: [...(defaultSchema.protocols?.src ?? []), "file", "data"] } };
export const ChatMarkdown = memo(function ChatMarkdown({ text, threadId, source, assetSource, streaming = false }: {
  text: string; threadId: string; source?: { environmentId: string; threadId: string; messageId: string }; assetSource?: ChatAssetSource; streaming?: boolean;
}) {
  const run = useActions();
  return <div className="markdown" data-assistant-citation-source={source?.messageId} data-assistant-citation-environment={source?.environmentId} data-assistant-citation-thread={source?.threadId}><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], [rehypeKatex, { strict: "ignore", trust: false, throwOnError: false }]]}
    urlTransform={(url, key) => url.startsWith("file:") || url.startsWith("t3-citation:") || (key === "src" && /^data:(image|video|audio)\//i.test(url)) ? url : defaultUrlTransform(url)}
    components={{
      a: ({ href, children }) => {
        const citation = href ? parseAssistantCitationHref(href) : null;
        if (citation) return <AssistantCitationLink citation={citation} />;
        return <a href={href} onClick={(event) => { event.preventDefault(); if (href) void run("openLink", { href, threadId }); }}>{children}</a>;
      },
      img: ({ alt, src }) => src ? <ChatMedia src={src} alt={alt || "Image"} threadId={threadId} source={assetSource} /> : <span>{alt}</span>,
      video: ({ src }) => src ? <ChatMedia src={src} alt="Video" kind="video" threadId={threadId} source={assetSource} /> : null,
      audio: ({ src }) => src ? <ChatMedia src={src} alt="Audio" kind="audio" threadId={threadId} source={assetSource} /> : null,
      pre: ({ children, node }) => {
        const code = node?.children[0];
        if (code?.type === "element" && code.tagName === "code" && Array.isArray(code.properties.className) && code.properties.className.includes("language-mermaid")) {
          const diagram = code.children.map((child) => child.type === "text" ? child.value : "").join("");
          return <MermaidVisual source={diagram} streaming={streaming} />;
        }
        return <pre>{children}</pre>;
      },
    }}>{normalizeMathMarkdown(text)}</ReactMarkdown></div>;
});
