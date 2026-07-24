import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT: change `base` to match your GitHub repo name.
// If your repo is https://github.com/username/lic-teaching-generator
// then base should be "/lic-teaching-generator/".
// If you deploy to a custom domain or user/organization root page, use "/".
export default defineConfig({
  plugins: [react()],
  base: '/medteaching/',
});