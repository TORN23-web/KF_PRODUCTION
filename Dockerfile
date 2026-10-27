FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
