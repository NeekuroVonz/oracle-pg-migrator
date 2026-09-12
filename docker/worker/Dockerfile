FROM oven/bun:1.3.13
WORKDIR /app
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN bun install --frozen-lockfile
WORKDIR /app/apps/worker
EXPOSE 3002
CMD ["bun", "src/main.ts"]
