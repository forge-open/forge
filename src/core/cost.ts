import type { TokenUsage } from './model.js';

/**
 * Cost estimation abstraction. Pricing lives in DATA, not code paths:
 * - DEFAULT_PRICES below are approximate public list prices (USD per million tokens),
 *   snapshotted 2026-08, matched by longest model-id prefix.
 * - Users override/extend via `.forge/prices.json` (same shape: model-prefix → ModelPrice).
 * - If a model has no entry we return null and callers must surface "unknown pricing"
 *   instead of inventing a number. Estimates are always labeled as estimates.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  'codex-mini': { input: 1.5, output: 6, cacheRead: 0.15, cacheWrite: 0 },
  'o3': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 0 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0 },
};

export type PriceTable = Record<string, ModelPrice>;

/** Longest-prefix lookup: "gpt-5-mini-2026-01" resolves against "gpt-5-mini" before "gpt-5". */
export function priceFor(model: string | undefined, table: PriceTable = DEFAULT_PRICES): ModelPrice | null {
  if (!model) return null;
  const m = model.toLowerCase();
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (m.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best ? table[best] : null;
}

/**
 * Estimated USD cost for one token-usage record, or null when pricing is unknown.
 * Missing components count as zero (e.g. cache fields absent on some providers).
 */
export function estimateCost(
  model: string | undefined,
  tokens: TokenUsage,
  table: PriceTable = DEFAULT_PRICES,
): number | null {
  const p = priceFor(model, table);
  if (!p) return null;
  const parts =
    (tokens.input ?? 0) * p.input +
    (tokens.output ?? 0) * p.output +
    (tokens.cacheRead ?? 0) * p.cacheRead +
    (tokens.cacheWrite ?? 0) * p.cacheWrite;
  return parts / 1_000_000;
}

/** Validate a user-supplied override table; returns [clean, problems]. */
export function sanitizePriceTable(input: unknown): [PriceTable, string[]] {
  const out: PriceTable = {};
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null) return [out, ['prices file: expected an object']];
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (typeof val !== 'object' || val === null) {
      problems.push(`${key}: expected object with input/output/cacheRead/cacheWrite`);
      continue;
    }
    const v = val as Record<string, unknown>;
    const nums = ['input', 'output', 'cacheRead', 'cacheWrite'].map((k) => v[k]);
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
      problems.push(`${key}: all fields must be non-negative numbers`);
      continue;
    }
    out[key.toLowerCase()] = v as unknown as ModelPrice;
  }
  return [out, problems];
}
