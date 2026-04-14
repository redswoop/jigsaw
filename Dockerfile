FROM oven/bun:alpine

WORKDIR /app
COPY package.json ./
COPY index.html server.js ./
COPY css/ ./css/
COPY js/ ./js/
COPY server/ ./server/
COPY images/ ./images/

ENV PORT=80
ENV BUGS_DIR=/data/bugs
ENV DATA_DIR=/data/db
VOLUME /data/bugs
VOLUME /data/db
EXPOSE 80
CMD ["bun", "server.js"]
