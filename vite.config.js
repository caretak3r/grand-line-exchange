import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at /<repo-name>/, so we read the repo name
// from the env var GitHub Actions provides (GITHUB_REPOSITORY = "owner/repo").
// For local dev, base is just '/'.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/';

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Split heavy vendors into their own chunks so no single JS file
    // trips the 500 kB warning. Vite 8 is rolldown-based: the supported
    // knob is rolldownOptions.output.codeSplitting (manualChunks is
    // deprecated there). First matching group wins, so recharts and
    // lucide are matched before the react catch-all.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'recharts', test: /node_modules[\\/](recharts|d3-|victory-vendor)/ },
            { name: 'lucide', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
