# Use Lightweight Node 20 LTS Image
FROM node:20-alpine

# Set Working Directory
WORKDIR /usr/src/app

# Copy Package Files
COPY package*.json ./

# Install Production Dependencies
RUN npm ci --only=production

# Copy Application Source Code
COPY . .

# Expose HTTP Server Port
EXPOSE 3000

# Set Environment Variables
ENV NODE_ENV=production

# Run Application
CMD ["node", "server.js"]