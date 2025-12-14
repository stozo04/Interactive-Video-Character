import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Proxy for Gemini Interactions API to bypass CORS in development
        // This only works in development (Vite dev server)
        // The API key is added in the fetch URL, so we just need to forward the request
        proxy: {
          '/api/google': {
            target: 'https://generativelanguage.googleapis.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/google/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        // Legacy API keys (non-VITE prefix - need manual mapping)
        'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL),
        'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        // Note: All VITE_* prefixed variables are automatically available via import.meta.env
        // No need to manually define them here
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      }
    };
});
