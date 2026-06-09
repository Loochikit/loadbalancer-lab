FROM node:20-alpine

# Set directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy codebase
COPY . .

# Expose control dashboard (8000) and proxy (8080)
EXPOSE 8000
EXPOSE 8080

# Run service
CMD ["node", "server.js"]
