# Changelog

## Unreleased

The `feature/new-syntax` work is being consolidated onto `main`. Package metadata
remains at `0.4.2`; no release version or tag is created by this consolidation.

### Breaking changes

- Replace `.topicDo(topics, handler)` with `.add({ topic: topics, do: handler })`.
- Replace `.scheduleDo(schedule, handler)` with `.add({ schedule, do: handler })`.
- Replace `.use({ topicDo: [...], scheduleDo: [...] })` with `.add([...rules])`.
  Arrays can mix topic and schedule rules; `.add()` remains chainable.
- Change `daily(hour, minute, second)` to `daily(scheduler, days = DAYS.all)`.
  To preserve a fixed daily time, use `daily(at(hour, minute, second))`.

### Added and changed

- Add `at(hours, minutes = 0, seconds = 0)` for a same-day local-time offset.
- Add `DAYS.weekdays`, `DAYS.weekends`, and `DAYS.all` for day selection.
- Allow custom daily schedulers, evaluated relative to each candidate day's local
  midnight, and fix next-eligible-day selection.
- Remove unconditional daily-scheduler logging.
- Rewrite README examples and document connection behavior, options, publishing,
  cache misses, scheduling semantics, and migration from the old API.
- Correct documentation to use named `broker`, `once`, mqtt.js `username`, and
  the publishing function passed to handlers. These corrections are not new exports
  or a change to the handler argument contract.
- Add `AGENTS.md` for repository guidance and `REVIEW.md` for the maintenance backlog.

### Not included

This consolidation does not fix the runtime or dependency issues identified in
`REVIEW.md`, introduce a test suite, or create a `dailyAt` compatibility export.

## 0.4.2

Previous `main` baseline, before the rule-object API and daily-scheduler changes.
