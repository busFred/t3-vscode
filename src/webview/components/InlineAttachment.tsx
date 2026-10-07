import { ImageIcon, FileIcon } from "lucide-react";
import type { ChatAttachment } from "@t3tools/contracts";
import type { ChatAssetSource } from "../../shared/chatVisuals";
import { openVisual, useChatAsset } from "./ChatMedia";
import { useActions } from "../actions";

export function InlineAttachment({ attachment, threadId, source }: { attachment: Pick<ChatAttachment, "id" | "name" | "mimeType" | "sizeBytes">; threadId: string; source?: ChatAssetSource | undefined }) {
  const run = useActions();
  const { asset, error, retry } = useChatAsset(threadId, source, { kind: "attachment", attachmentId: attachment.id });
  const image = attachment.mimeType.startsWith("image/");
  return <button className="inline-attachment" aria-label={`${image ? "Preview" : "Open"} attachment ${attachment.name}`} title={error ?? attachment.name} disabled={!asset && !error} onClick={() => {
    if (error) { retry(); return; }
    if (!asset) return;
    if (image) openVisual({ title: attachment.name, src: asset.url });
    else void run("openLink", { href: asset.url });
  }}>{image ? <ImageIcon size={12} /> : <FileIcon size={12} />}{attachment.name}{error ? " · Retry" : ""}</button>;
}
