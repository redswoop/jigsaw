FROM node:alpine

WORKDIR /app
COPY index.html server.js card*.png card*.mp4 ./

ENV PORT=80
ENV BUGS_DIR=/data/bugs
VOLUME /data/bugs
EXPOSE 80
CMD ["node", "server.js"]
