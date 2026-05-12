import { defineConfig } from 'vite'
import * as fs from 'node:fs'

const TELEMETRY_LOG_PATH =
  process.env.PAGETURN_TELEMETRY_LOG ?? '/tmp/pageturn-telemetry.jsonl'

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
    {
      // Telemetry sink — receives POST /__telemetry from src/telemetry.ts and
      // appends each event as a single JSON line to PAGETURN_TELEMETRY_LOG
      // (default /tmp/pageturn-telemetry.jsonl).  Truncates the log on server
      // startup so each `npm run dev` begins with an empty file.  Designed to
      // let an agent monitor the prototype's runtime via `tail -f`.
      name: 'telemetry-sink',
      configureServer(server) {
        // Truncate at startup so each dev session is self-contained.
        try {
          fs.writeFileSync(TELEMETRY_LOG_PATH, '')
          server.config.logger.info(
            `[telemetry-sink] writing to ${TELEMETRY_LOG_PATH} (truncated)`,
          )
        } catch (err) {
          server.config.logger.warn(
            `[telemetry-sink] could not truncate ${TELEMETRY_LOG_PATH}: ${(err as Error).message}`,
          )
        }

        server.middlewares.use('/__telemetry', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end()
            return
          }
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            let parsed: Record<string, unknown> = {}
            try {
              parsed = JSON.parse(raw)
            } catch {
              // Keep raw payload so corrupt events are still observable.
              parsed = { _parseError: true, raw }
            }
            const line =
              JSON.stringify({ ts: new Date().toISOString(), ...parsed }) + '\n'
            // Async fire-and-forget — do not block the response on disk I/O.
            fs.appendFile(TELEMETRY_LOG_PATH, line, () => { /* swallow */ })
            res.statusCode = 204
            res.end()
          })
          req.on('error', () => {
            res.statusCode = 400
            res.end()
          })
        })
      },
    },
  ],
})
