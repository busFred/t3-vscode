import test from "node:test";
import assert from "node:assert/strict";
import { DATE_FORMATS, formatDate, resolveDateFormat, resolveTimeFormat, timeFormatOptions } from "./timeFormat.js";
test("Time overrides work across locales and preserve automatic defaults and midnight", () => {
  for (const locale of ["en-US", "en-GB"]) {
    const midnight = new Date("2026-10-18T00:05:00Z");
    const options = { hour: "2-digit", minute: "2-digit", timeZone: "UTC" } as const;
    assert.equal(midnight.toLocaleTimeString(locale, { ...options, ...timeFormatOptions("automatic") }), midnight.toLocaleTimeString(locale, options));
    assert.equal(midnight.toLocaleTimeString(locale, { ...options, ...timeFormatOptions("24-hour") }), "00:05");
    assert.match(midnight.toLocaleTimeString(locale, { ...options, ...timeFormatOptions("12-hour") }), /^12:05\s?am$/i);
    assert.equal(new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long", ...timeFormatOptions("24-hour") }).resolvedOptions().hourCycle, "h23");
  }
  for (const value of [null, undefined, "bad", 24]) assert.equal(resolveTimeFormat(value), "automatic");
  assert.equal(resolveTimeFormat("12-hour"), "12-hour"); assert.equal(resolveTimeFormat("24-hour"), "24-hour");
});

test("Date dropdown formats use local calendar fields and exact example order", () => {
  const date = new Date(2017, 3, 5, 16, 3, 22);
  assert.deepEqual(DATE_FORMATS.map(format => formatDate(date, format)), ["4/5/2017", "4/5/17", "04/05/17", "04/05/2017", "17/04/05", "2017-04-05", "05-Apr-17", "05/04/2017", "05.04.2017", "Apr 5, 2017", "5 Apr 2017"]);
  assert.equal(resolveDateFormat("invalid"), "yyyy-MM-dd");
});
