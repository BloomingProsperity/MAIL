FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api-node/package.json apps/api-node/package.json
COPY apps/worker-node/package.json apps/worker-node/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/api-node apps/api-node
RUN npm run build -w apps/api-node

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=8080

COPY package.json package-lock.json ./
COPY apps/api-node/package.json apps/api-node/package.json
COPY apps/worker-node/package.json apps/worker-node/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev -w apps/api-node

COPY --from=build /app/apps/api-node/dist apps/api-node/dist

EXPOSE 8080
CMD ["node", "apps/api-node/dist/server.js"]
