import { parseEventsJsonl } from '../core/events.js';
import type { ParseResult } from '../core/model.js';

/**
 * Generic adapter: accepts newline-delimited JSON already in Forge's canonical
 * event shape (see docs/events.md). This is the integration boundary every other
 * coding agent can target directly — emit these lines, call `forge import jsonl`.
 *
 * Reuses the canonical validator so malformed records are dropped with warnings.
 */
export function jsonlToEvents(text: string): ParseResult {
  return parseEventsJsonl(text);
}
