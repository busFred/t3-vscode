# Session activity time — proposed layout

Status: implemented in the v0.1.16 source revision; installer pending combined verification. The HTML remains a design reference.

Open [the interactive mockup](session-activity.html) in a browser. It uses fixed sample data and keeps all interaction in memory.

- Put a muted, right-aligned time on the existing metadata line, immediately before the provider icon. Keep the title's full width and the current 49px row height.
- Keep branch names or search snippets on the left; truncate them before the activity time. Sessions without a branch still use the same metadata line.
- Use `<1 min`, whole minutes, whole hours, and whole days through 7 days. After 7 days, show a local date such as `Sep 29`; include the year when it differs from the current year.
- Hover shows the exact local timestamp. Selected rows retain readable time text; accessible labels describe the last activity. Settled and Archive use the same placement.
- Last activity should mean conversation messages/run activity. Opening, selecting, renaming or pinning a session must not reset it. The existing Working badge continues to show the current run's elapsed time separately.

Implementation: uses the latest message, run or pending-input timestamp, never the general metadata update time. Empty sessions use creation; historical sessions without an activity timestamp remain blank. Labels refresh each minute and after visibility changes. Timestamp-source and format-boundary tests cover these rules.

Validation: previewed at 280px in the inline HTML renderer; checked 280px light and 240px dark layouts in a temporary Chromium profile. Confirmed 49px rows, every requested time format, exact-time tooltips, search, shelf dates with older years, no horizontal overflow, and unchanged timestamps after selecting another session. No T3 state, extension profile or provider was accessed.
