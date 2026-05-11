# Use the official Playwright image — has Node + Chromium + system deps
# preinstalled. Pinning a specific tag means this layer is cached locally
# across every project that uses the same FROM line, so the multi-GB
# Playwright browser download happens at most once per host.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /work

# ── Layer 1: harness deps (changes rarely) ───────────────────────────────────
COPY harness/package.json ./harness/
RUN cd harness && npm install --no-audit --no-fund --omit=optional

# ── Layer 2: app deps (changes when package.json changes) ────────────────────
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=optional

# ── Layer 3: source (changes on every commit) ────────────────────────────────
COPY . .

# The harness needs the Vite dev server to be reachable. We launch it in the
# background and run the Playwright driver against it. Using `vite preview`
# would also work after `npm run build`, but dev is faster to iterate against.
EXPOSE 5173
ENV HARNESS_URL=http://localhost:5173/harness.html

# Wait-for-port helper baked inline — keeps Dockerfile self-contained.
CMD ["sh", "-c", "\
  npx vite --host 0.0.0.0 --port 5173 & \
  VITE_PID=$!; \
  for i in $(seq 1 60); do \
    if curl -fsS http://localhost:5173/harness.html >/dev/null 2>&1; then break; fi; \
    sleep 0.5; \
  done; \
  cd harness && npm run run:all; \
  STATUS=$?; \
  kill $VITE_PID 2>/dev/null; \
  exit $STATUS \
"]
