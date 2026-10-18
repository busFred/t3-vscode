import { useDateTimeFormat } from "../timeFormat";
/** Use the recorded start time, never render time or the time a streaming reply completes. */
export function MessageTimestamp({ value }: { value: string | null | undefined }) {
  const { dateTime } = useDateTimeFormat();
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return <span className="message-timestamp" title="This message has no recorded timestamp">Time unavailable</span>;
  return <time className="message-timestamp" dateTime={value!} title={dateTime(date)}>{dateTime(date)}</time>;
}
