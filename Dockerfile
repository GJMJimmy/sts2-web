FROM node:24-alpine AS build
WORKDIR /app

RUN npm install --global pnpm@11.22.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/app/package.json ./packages/app/package.json
COPY packages/core/package.json ./packages/core/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY assets ./assets
RUN pnpm build

FROM nginx:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/app/dist /usr/share/nginx/html
EXPOSE 80
