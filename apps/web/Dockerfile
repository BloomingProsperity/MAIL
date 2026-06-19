FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api-node/package.json apps/api-node/package.json
COPY apps/worker-node/package.json apps/worker-node/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web apps/web
ARG VITE_EMAILHUB_DEFAULT_ACCOUNT_ID=
ENV VITE_EMAILHUB_DEFAULT_ACCOUNT_ID=$VITE_EMAILHUB_DEFAULT_ACCOUNT_ID
RUN npm run build -w apps/web

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
