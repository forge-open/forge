import readline from 'node:readline/promises';
import type { Readable } from 'node:stream';

/**
 * Terminal capability detection + interaction helpers.
 *
 * The report renderer stays PURE: callers decide unicode/color via options
 * (see renderTerminal). These helpers only DECIDE what the local terminal
 * supports, with explicit overrides so users and tests can force either mode.
 */

export interface TermCaps {
  unicode: boolean;
  color: boolean;
}

export function termCaps(
  stream: { isTTY?: boolean } = process.stdout,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): TermCaps {
  const isTTY = stream.isTTY === true;
  if (env.FORCE_ASCII === '1') return { unicode: false, color: false };

  const color = isTTY && !env.NO_COLOR && env.CI !== 'true' && env.CI !== '1';
  let unicode = isTTY && env.CI !== 'true' && env.CI !== '1';
  if (unicode && platform === 'win32') {
    // Legacy conhost (cmd/PowerShell with codepage 437) renders box-drawing as
    // garbage; every terminal that sets these markers handles UTF-8 fine.
    unicode = !!(
      env.WT_SESSION ||
      env.TERM_PROGRAM ||
      env.MINTTY_SHORTCUT ||
      env.ANSICON ||
      (env.TERM ?? '').includes('xterm')
    );
  }
  if (env.FORCE_UNICODE === '1') unicode = true;
  return { unicode, color };
}

/** Minimal ANSI styling; strips to plain text whenever color is off. */
export interface Style {
  dim(s: string): string;
  ok(s: string): string;
  warn(s: string): string;
  fail(s: string): string;
}

export function makeStyle(color: boolean): Style {
  if (!color) {
    const id = (s: string): string => s;
    return { dim: id, ok: id, warn: id, fail: id };
  }
  const wrap = (code: string, s: string): string => `\x1b[${code}m${s}\x1b[0m`;
  return {
    dim: (s) => wrap('2', s),
    ok: (s) => wrap('32', s),
    warn: (s) => wrap('33', s),
    fail: (s) => wrap('31', s),
  };
}

/**
 * Yes/no prompt. Defaults to yes on Enter; any non-TTY stdin (scripts, CI)
 * skips interaction entirely and takes the default.
 */
export async function confirm(
  input: Readable & { isTTY?: boolean },
  question: string,
  defaultYes = true,
): Promise<boolean> {
  if (input.isTTY !== true && process.env.FORCE_PROMPT !== '1') return defaultYes;
  const rl = readline.createInterface({ input, output: process.stdout, terminal: false });
  try {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    for (;;) {
      const answer = (await rl.question(`${question} ${hint} `)).trim().toLowerCase();
      if (answer === '' ) return defaultYes;
      if (answer === 'y' || answer === 'yes') return true;
      if (answer === 'n' || answer === 'no') return false;
      if (answer === 'q') return false;
    }
  } finally {
    rl.close();
  }
}
