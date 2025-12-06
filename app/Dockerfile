FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY lib/ ./lib/
COPY public/ ./public/
COPY models/ ./models/
COPY index.js ./

# Create directory for runtime data
RUN mkdir -p /app/data

# etc/config.json must be mounted at runtime (contains credentials)
VOLUME ["/app/etc"]

EXPOSE 8080

CMD ["node", "index.js"]
