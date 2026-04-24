# Use the official Playwright image which ships Chromium + all system deps
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

WORKDIR /app

# Install Node dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright's bundled Chromium (already included in base image,
# but running this ensures the right channel is registered)
RUN npx playwright install chromium --with-deps

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm install --save-dev typescript tsx && npx tsc

EXPOSE 3000

CMD ["node", "dist/index.js"]
