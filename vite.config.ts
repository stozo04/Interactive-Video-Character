import path from 'path';
import fs from 'fs';
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
      plugins: [
        react(),
        {
          name: 'base64-loader',
          transform(code, id) {
            if (id.includes('?base64')) {
              const filePath = id.split('?')[0];
              const buffer = fs.readFileSync(filePath);
              const base64 = buffer.toString('base64');
              const ext = path.extname(filePath).toLowerCase();
              const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
              return {
                code: `export default "data:${mimeType};base64,${base64}";`,
                map: null
              };
            }
          }
        },
        {
          name: 'save-selfie-plugin',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url === '/api/save-selfie' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk.toString();
                });
                req.on('end', () => {
                  try {
                    const { imageBase64, scene } = JSON.parse(body);
                    const buffer = Buffer.from(imageBase64, 'base64');
                    
                    // Create a safe filename
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const safeScene = scene ? scene.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'selfie';
                    const filename = `selfie_${timestamp}_${safeScene}.jpg`;
                    const filePath = path.join(process.cwd(), 'selfies', filename);
                    
                    if (!fs.existsSync(path.join(process.cwd(), 'selfies'))) {
                      fs.mkdirSync(path.join(process.cwd(), 'selfies'), { recursive: true });
                    }
                    
                    fs.writeFileSync(filePath, buffer);
                    console.log(`💾 [Vite] Saved selfie: ${filename}`);
                    
                    res.statusCode = 200;
                    res.end(JSON.stringify({ success: true, filename }));
                  } catch (error) {
                    console.error('❌ [Vite] Error saving selfie:', error);
                    res.statusCode = 500;
                    res.end(JSON.stringify({ success: false, error: 'Failed to save selfie' }));
                  }
                });
              } else {
                next();
              }
            });
          }
        }
      ],
      define: {
        // Legacy API keys (non-VITE prefix - need manual mapping)
        'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL),
        'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        // No need to manually define them here
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      }
    };
});
