FROM oven/bun:1.3.13
WORKDIR /app
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages ./packages
COPY apps/api ./apps/api
RUN bun install --frozen-lockfile
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["bun", "src/main.ts"]
