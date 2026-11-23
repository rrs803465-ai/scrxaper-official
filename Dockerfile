FROM node:22-alpine
WORKDIR /app
COPY package.json server.js extras.js ./
COPY public ./public
ENV NODE_ENV=production
CMD ["npm", "start"]
