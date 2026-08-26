import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PriceTable } from './cost.js';
import { DEFAULT_PRICES, sanitizePriceTable } from './cost.js';

/**
 * Loads `.forge/prices.json` overrides (if present) and merges them over
 * DEFAULT_PRICES. Separate from pure cost math so pricing logic stays fs-free.
 */
export async function loadPriceTable(forgeDir: string): Promise<{ table: PriceTable; problems: string[] }> {
  let raw: unknown = null;
  try {
    const text = await fsp.readFile(path.join(forgeDir, 'prices.json'), 'utf8');
    raw = JSON.parse(text);
  } catch {
    raw = null; // no override file (or unreadable) → defaults only
  }
  const [table, problems] = sanitizePriceTable(raw ?? {});
  return { table: { ...DEFAULT_PRICES, ...table }, problems };
}
