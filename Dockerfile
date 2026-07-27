FROM node:20-slim

# Install python3, ffmpeg, ca-certificates, and curl
RUN apt-get update && \
    apt-get install -y python3 ffmpeg ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Start the bot
CMD ["npm", "start"]
