# Built with the repository root as build context (see docker-compose.yml)
# because the app depends on the npm workspaces defined there.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/publisher/package.json apps/publisher/
COPY apps/viewer/package.json apps/viewer/
COPY packages/schema/package.json packages/schema/
COPY packages/web-shared/package.json packages/web-shared/
RUN npm ci

COPY . .

EXPOSE 5174

CMD ["npm", "run", "dev", "-w", "@yrdy-kbd/viewer", "--", "--host", "0.0.0.0", "--port", "5174"]
