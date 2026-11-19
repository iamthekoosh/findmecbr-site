# Serves the site and rebuilds it from Strapi in the background (see server.mjs).
# Pages on 4321. Rebuild trigger on 4322, for Strapi inside the server only.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 4321
CMD ["node", "server.mjs"]
