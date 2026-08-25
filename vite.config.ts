import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import cesium from 'vite-plugin-cesium'

// https://vite.dev/config/
export default defineConfig({
  base: '/forced-landing-planner/',
  plugins: [react(), cesium()],
  test: {
    environment: 'node',
    include: ['src/lib/**/*.test.ts'],
  },
})
