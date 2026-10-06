/** T3 markdown presentation with file and external links delegated to VS Code. */
import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useActions } from "../actions";
export const ChatMarkdown = memo(function ChatMarkdown({ text, threadId }: { text: string; threadId: string }) {
  const run = useActions();
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}
    urlTransform={(url) => url.startsWith("file:") ? url : defaultUrlTransform(url)}
    components={{
      a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void run("openLink", { href, threadId }); }}>{children}</a>,
      img: ({ alt, src }) => <span className="attachment-label">{alt || "Image"}{src ? <button className="text-button" onClick={() => { void run("openLink", { href: src, threadId }); }}>Open</button> : null}</span>,
    }}>{text}</ReactMarkdown></div>;
});
