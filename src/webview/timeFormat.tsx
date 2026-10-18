import { createContext, useContext } from "react";
import { formatDate, timeFormatOptions, type DateFormat, type TimeFormat } from "../shared/timeFormat";
export const TimeFormatContext = createContext<TimeFormat>("automatic");
export function useTimeFormat() { return timeFormatOptions(useContext(TimeFormatContext)); }

export const DateFormatContext = createContext<DateFormat>("yyyy-MM-dd");
export function useDateTimeFormat() {
  const format = useContext(DateFormatContext), options = useTimeFormat();
  const date = (value: Date) => formatDate(value, format);
  return { date, dateTime: (value: Date) => `${date(value)} · ${value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", ...options })}` };
}
