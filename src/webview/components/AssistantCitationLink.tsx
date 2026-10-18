import { createContext, useContext } from "react";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from "lucide-react";
import type { AssistantCitation } from "../../shared/messageCitations.js";
import { setCitationExpanded, useCitationExpanded } from "../citationExpansion";
import { quoteDisplayText } from "../../shared/assistantQuoteText";

export const citationKey = (citation: AssistantCitation) => [citation.environmentId, citation.threadId, citation.messageId, citation.start, citation.end, citation.text].join("\u0000");
export const AssistantCitationNumbersContext = createContext<ReadonlyMap<string, number> | null>(null);

export function AssistantCitationLink({ citation }: { readonly citation: AssistantCitation }) {
  const key = citationKey(citation);
  const expanded = useCitationExpanded(key); const number = useContext(AssistantCitationNumbersContext)?.get(key);
  // The key, not a ref: a search jump expands the card before its row is even mounted.
  return <span className="citation-card" data-expanded={expanded} data-citation-key={key}>
    <span className="citation-card-quote">
      <span className="citation-card-badge" aria-hidden="true">❝{number}</span>
      <span className="citation-card-text">{quoteDisplayText(citation.text, expanded)}</span>
      <span className="citation-card-tools">
        <button type="button" className="citation-card-tool" aria-label={expanded ? "Collapse quote" : "Expand quote"} title={expanded ? "Collapse quote" : "Expand quote"} aria-expanded={expanded} onClick={() => setCitationExpanded(key, !expanded)}>{expanded ? <ChevronUpIcon size={13} /> : <ChevronDownIcon size={13} />}</button>
        <button type="button" className="citation-card-tool" aria-label="Open quote source" title="Open quote source" onClick={() => window.dispatchEvent(new CustomEvent("t3-open-citation", { detail: citation }))}><ExternalLinkIcon size={13} /></button>
      </span>
    </span>
    {/* Labelled, and a real node rather than generated content, so the comment stays selectable and attributable to its quote. */}
    {citation.comment === undefined ? null : <span className="citation-card-comment"><span className="citation-card-comment-label">Comment:</span> {citation.comment}</span>}
  </span>;
}
