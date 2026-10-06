import { isProviderSendTurnSupportedImageMimeType, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, PROVIDER_SEND_TURN_MAX_FILE_BYTES, type ChatAttachment, type AttachmentCreateUploadUrlInput } from "@t3tools/contracts";
import { mediaMimeType } from "@t3tools/shared/filePreview";

export interface DraftAttachment {
  readonly key: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly previewUrl?: string;
  readonly attachment?: ChatAttachment;
  readonly environmentId?: string;
  readonly pending?: boolean;
  readonly error?: string;
}
const fileTypes: Record<string, string> = { pdf: "application/pdf", json: "application/json", csv: "text/csv", txt: "text/plain", md: "text/markdown", py: "text/x-python", js: "text/javascript", ts: "text/plain", html: "text/html", css: "text/css", zip: "application/zip" };
export function attachmentMimeType(name: string, reported = ""): string {
  return reported.trim().toLowerCase() || mediaMimeType(name) || fileTypes[name.split(".").at(-1)?.toLowerCase() ?? ""] || "application/octet-stream";
}
export function attachmentUploadInput(name: string, mimeType: string, sizeBytes: number): AttachmentCreateUploadUrlInput {
  const mime = attachmentMimeType(name, mimeType);
  const type = isProviderSendTurnSupportedImageMimeType(mime) ? "image" : "file";
  const max = type === "image" ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
  if (!name.trim() || name.length > 255 || mime.length > 100 || !Number.isInteger(sizeBytes) || sizeBytes < 1) throw new Error("Choose a nonempty file with a valid name and type.");
  if (sizeBytes > max) throw new Error(`'${name}' exceeds the ${max / 1024 / 1024} MB attachment limit.`);
  return { type, name, mimeType: mime, sizeBytes } as AttachmentCreateUploadUrlInput;
}
