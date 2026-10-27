import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests don't load the Figma Make plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
