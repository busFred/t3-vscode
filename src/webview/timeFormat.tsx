import { createContext, useContext } from "react";
import { timeFormatOptions, type TimeFormat } from "../shared/timeFormat";
export const TimeFormatContext = createContext<TimeFormat>("automatic");
export function useTimeFormat() { return timeFormatOptions(useContext(TimeFormatContext)); }
