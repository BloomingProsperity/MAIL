FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api-node/package.json apps/api-node/package.json
COPY apps/worker-node/package.json apps/worker-node/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/worker-node apps/worker-node
RUN npx tsc -p apps/worker-node/tsconfig.prod.json

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api-node/package.json apps/api-node/package.json
COPY apps/worker-node/package.json apps/worker-node/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev -w apps/worker-node

COPY --from=build /app/apps/worker-node/dist apps/worker-node/dist

CMD ["node", "apps/worker-node/dist/main.js"]
