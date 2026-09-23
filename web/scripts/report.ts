import { DatabaseUnavailable } from '../src/lib/db';

/** Prints an error the way a person needs to read it, then exits non-zero. */
export function reportAndExit(err: unknown): void {
  if (err instanceof DatabaseUnavailable) {
    console.error(`\n${err.message}`);
    if (err.detail) console.error(`\n${err.detail}`);
    console.error('');
  } else {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  }
  process.exitCode = 1;
}
