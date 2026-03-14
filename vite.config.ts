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
          '/api/anthropic': {
            target: 'http://127.0.0.1:4010',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/anthropic/, '/anthropic'),
          },
          '/api/x-upload': {
            target: 'https://upload.twitter.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/x-upload/, ''),
          },
          '/api/x': {
            target: 'https://api.x.com',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/x/, ''),
          },
          '^/agent(?:/|$)': {
            target: 'http://127.0.0.1:4010',
            changeOrigin: true,
          },
          '/multi-agent': {
            target: 'http://127.0.0.1:4010',
            changeOrigin: true,
          },
          '/whatsapp-bridge': {
            target: 'http://127.0.0.1:4011',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/whatsapp-bridge/, ''),
          },
          '/telegram-bridge': {
            target: 'http://127.0.0.1:4011',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/telegram-bridge/, ''),
          },
          '/opey-agent': {
            target: 'http://127.0.0.1:4013',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/opey-agent/, ''),
          },
          '/tidy-agent': {
            target: 'http://127.0.0.1:4014',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/tidy-agent/, ''),
          },
        },
      },
      plugins: [
        react(),
        {
          name: 'agents-md-raw-loader',
          enforce: 'pre',
          load(id) {
            if (!id.includes('/agents/') || !id.includes('.md') || !id.includes('?raw')) {
              return null;
            }

            const [fileId] = id.split('?', 1);
            const normalizedId = fileId.replace(/\\/g, '/');
            const agentsSegment = '/agents/';
            const agentsIndex = normalizedId.indexOf(agentsSegment);

            if (agentsIndex === -1) {
              return null;
            }

            const relativeAgentsPath = normalizedId.slice(agentsIndex + 1);
            const absolutePath = path.resolve(process.cwd(), relativeAgentsPath);

            if (!absolutePath.startsWith(path.resolve(process.cwd(), 'agents'))) {
              return null;
            }

            const content = fs.readFileSync(absolutePath, 'utf-8');

            return {
              code: `export default ${JSON.stringify(content)};`,
              map: null,
            };
          },
        },
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
        },
        {
          name: 'save-video-plugin',
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              if (req.url === '/api/save-video' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk.toString();
                });
                req.on('end', async () => {
                  try {
                    const { videoUrl, scene } = JSON.parse(body);

                    // Download video from URL
                    console.log(`🎬 [Vite] Downloading video from: ${videoUrl}`);
                    const response = await fetch(videoUrl);
                    if (!response.ok) {
                      throw new Error(`Failed to download video: ${response.status}`);
                    }
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    // Create a safe filename
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const safeScene = scene ? scene.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'video';
                    const filename = `video_${timestamp}_${safeScene}.mp4`;
                    const videosDir = path.join(process.cwd(), 'videos');
                    const filePath = path.join(videosDir, filename);

                    if (!fs.existsSync(videosDir)) {
                      fs.mkdirSync(videosDir, { recursive: true });
                    }

                    fs.writeFileSync(filePath, buffer);
                    console.log(`💾 [Vite] Saved video: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

                    res.statusCode = 200;
                    res.end(JSON.stringify({ success: true, filename }));
                  } catch (error) {
                    console.error('❌ [Vite] Error saving video:', error);
                    res.statusCode = 500;
                    res.end(JSON.stringify({ success: false, error: 'Failed to save video' }));
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
      build: {
        rollupOptions: {
          // Server-only code pulled into the build graph uses Node.js builtins
          // both with and without the node: prefix. Externalize both forms so
          // Rollup doesn't try to bundle named exports from browser stubs.
          external: [/^node:/, /^(fs|path|os|crypto|child_process|util|stream|events|process|net|http|https|url|buffer|readline|tty|worker_threads|zlib|assert|timers|querystring|string_decoder|vm|cluster|dgram|dns|perf_hooks|tls|v8)(\/.*)?$/, /^@anthropic-ai\//],
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      },
      test: {
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/.worktrees/**',
        ],
      },
    };
});
