# Builds the site from Strapi when the container starts, then serves the pages.
# Restart the container to rebuild with the latest published listings.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV HOST=0.0.0.0
EXPOSE 4321
CMD ["sh", "-c", "npm run build && npx astro preview --host 0.0.0.0 --port 4321"]
