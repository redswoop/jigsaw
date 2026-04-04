FROM node:alpine

WORKDIR /app
COPY index.html server.js ./
COPY css/ ./css/
COPY js/ ./js/
COPY images/ ./images/

ENV PORT=80
ENV BUGS_DIR=/data/bugs
VOLUME /data/bugs
EXPOSE 80
CMD ["node", "server.js"]
