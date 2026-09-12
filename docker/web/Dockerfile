FROM oven/bun:1.3.13
WORKDIR /app
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
COPY apps/web ./apps/web
RUN bun install --frozen-lockfile
WORKDIR /app/apps/web
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "start"]
