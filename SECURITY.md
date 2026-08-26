# Security Policy

Forge observes AI coding-agent work, so it handles potentially sensitive metadata.
The design assumes transcripts may contain references to private code and must
never leak.

## Threat model & guarantees

**What Forge stores:** canonical events under `<project>/.forge/runs/` (token
counts, tool names, task titles, file paths, timestamps) plus generated reports.

**What Forge never intentionally stores:** prompt/completion bodies, raw shell
commands, API keys, environment contents. Free-text fields are truncated and
scrubbed of common secret shapes (`sk-…`, `ghp_…`, `xox…-…`, AWS `AKIA…`) as
defense-in-depth — adapters must not emit secrets in the first place.

**Network:** the CLI makes **no network requests**. Reports are static files;
`forge open` asks your own browser to view a local `file://`. There is no
telemetry, no accounts, no cloud component.

**HTML report:** fully self-contained, no external resources, and every dynamic
string is HTML-escaped before rendering.

## Recommendations for users

- Treat `.forge/` like `.git/`: it is already excluded by this repo's `.gitignore`;
  keep it out of archives you share. Reports can mention file paths and task
  summaries from your runs.
- If your agent emits custom JSONL events, sanitize free-text fields at the source.

## Trust boundary notes

- `.forge/` is project-local, user-writable state. Forge validates run ids and
  meta files defensively (strict id pattern, shape-checked `meta.json`, directory
  name is authoritative), but it does not defend against an attacker who can
  already write arbitrary files into your project — that is outside a local
  developer tool's threat model. Don't point Forge at untrusted projects and
  then blindly trust planted run data.
- `forge open` hands the report path to your OS browser launcher with no shell
  interpretation on any platform.

## Reporting a vulnerability

Use GitHub's "Report a vulnerability" (Security → Advisories) on
`forge-open/forge`. Please avoid public issues for exploitable bugs. We aim to
respond within 7 days.
