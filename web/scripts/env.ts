/**
 * Loads .env.local / .env the same way Next.js does.
 *
 * Next reads those files itself when it boots, but a plain `tsx scripts/…`
 * process does not, so every script imports this FIRST — before anything that
 * touches process.env.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());
