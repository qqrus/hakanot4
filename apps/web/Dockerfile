FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY apps apps
COPY packages packages

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace", "@collabcode/web", "--", "--hostname", "0.0.0.0", "--port", "3000"]
