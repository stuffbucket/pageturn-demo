import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'esnext',
  },
  plugins: [
    {
      // Large self-hosted media (e.g. big-buck-bunny.mp4) shouldn't be
      // re-downloaded on every dev reload. Without an explicit Cache-Control
      // header, Vite falls back to heuristic caching, which Chromium often
      // ignores for video resources.
      name: 'long-cache-videos',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && /^\/videos\//.test(req.url)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          }
          next()
        })
      },
    },
  ],
})
