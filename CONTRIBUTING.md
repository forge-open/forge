# Contributing to Forge

Forge is an open-source, local-first observability layer for AI coding-agent swarms.
Contributions that keep it small, honest, and vendor-neutral are especially welcome.

## Ground rules

1. **TypeScript, ESM, Node ≥ 18, zero runtime dependencies.** Dev deps live in
   `devDependencies` only.
2. **Vendor neutrality:** only files under `src/adapters/` may know a vendor's
   transcript format. Core stays canonical.
3. **Facts vs inferences:** aggregation (`src/core`) produces observed facts;
   insights are rule-based and must cite their evidence. No invented claims, no
   AI-judged scores without a deterministic fallback.
4. **Privacy/local-first:** never log or persist prompt/completion content, secrets,
   or credentials. Nothing leaves the machine. Free-text fields stay truncated and
   sanitized.
5. **No speculative features:** if it isn't part of OBSERVE → EVALUATE → OPTIMIZE →
   RUN AGAIN, open an issue first.

## Development

```bash
npm install
npm run typecheck     # strict tsc
npm test              # node:test via tsx
npm run build         # emit dist/
npm run demo          # end-to-end: synthetic swarm run → report
```

Relative imports need `.js` extensions (NodeNext resolution).

## Pull requests

1. Fork and create a feature branch.
2. Add/adjust tests for behavior changes; keep the full suite green.
3. Run `npm run typecheck && npm test`.
4. Describe what the change measures or renders, and why existing behavior was wrong.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md). Please do not open public issues for
vulnerabilities.
