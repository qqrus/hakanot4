FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY apps apps
COPY packages packages
COPY demo demo

EXPOSE 4000

CMD ["sh", "-c", "npm run db:init --workspace @collabcode/server && npm run dev --workspace @collabcode/server"]
