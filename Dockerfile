FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY server ./server
COPY public ./public
COPY src ./src
COPY index.html vite.config.js ./

RUN npm ci
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=8787

COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY server ./server

RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 8787

CMD ["npm", "run", "start"]
