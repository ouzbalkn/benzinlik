FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/
RUN cd server && npm install --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 80
CMD ["node", "server/index.js"]
