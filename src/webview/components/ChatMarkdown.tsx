/** T3 markdown presentation with file and external links delegated to VS Code. */
import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import { useActions } from "../actions";
import { AssistantCitationLink } from "./AssistantCitationLink";
export const ChatMarkdown = memo(function ChatMarkdown({ text, threadId, source }: { text: string; threadId: string; source?: { environmentId: string; threadId: string; messageId: string } }) {
  const run = useActions();
  return <div className="markdown" data-assistant-citation-source={source?.messageId} data-assistant-citation-environment={source?.environmentId} data-assistant-citation-thread={source?.threadId}><ReactMarkdown remarkPlugins={[remarkGfm]}
    urlTransform={(url) => url.startsWith("file:") || url.startsWith("t3-citation:") ? url : defaultUrlTransform(url)}
    components={{
      a: ({ href, children }) => {
        const citation = href ? parseAssistantCitationHref(href) : null;
        if (citation) return <AssistantCitationLink citation={citation} />;
        return <a href={href} onClick={(event) => { event.preventDefault(); if (href) void run("openLink", { href, threadId }); }}>{children}</a>;
      },
      img: ({ alt, src }) => <span className="attachment-label">{alt || "Image"}{src ? <button className="text-button" onClick={() => { void run("openLink", { href: src, threadId }); }}>Open</button> : null}</span>,
    }}>{text}</ReactMarkdown></div>;
});
