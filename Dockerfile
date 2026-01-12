# Use Node.js with Playwright pre-installed
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Install Playwright browsers (Chromium only)
RUN npx playwright install chromium

# Copy application files
COPY server.js ./
COPY public ./public

# Create directory for debug files
RUN mkdir -p /app/debug

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Run the server
CMD ["node", "server.js"]

