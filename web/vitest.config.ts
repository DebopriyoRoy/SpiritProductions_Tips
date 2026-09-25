import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * macOS writes AppleDouble sidecars (`._config.test.ts`) beside every file
     * it touches on exFAT and other non-native volumes. They are binary Finder
     * metadata, but the name matches vitest's default test glob, so the run
     * fails with `Unexpected "\x00"` on a file nobody wrote.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/._*'],
  },
});
