import { useTimeFormat } from "../timeFormat";
/** Use the recorded start time, never render time or the time a streaming reply completes. */
export function MessageTimestamp({ value }: { value: string | null | undefined }) {
  const timeOptions = useTimeFormat();
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return <span className="message-timestamp" title="This message has no recorded timestamp">Time unavailable</span>;
  return <time className="message-timestamp" dateTime={value!} title={date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long", ...timeOptions })}>{date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} · {date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", ...timeOptions })}</time>;
}
