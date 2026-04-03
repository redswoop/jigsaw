# ── Stage 1: Clone ───────────────────────────────────────────
FROM alpine/git AS builder

WORKDIR /app
ARG CACHEBUST=0
ARG GIT_REF=main
RUN echo "bust=${CACHEBUST}" \
    && git clone --depth 1 --branch ${GIT_REF} --single-branch \
       https://github.com/redswoop/jigsaw.git .

# ── Stage 2: Production (Node server) ────────────────────────
FROM node:alpine

WORKDIR /app
COPY --from=builder /app/index.html /app/
COPY --from=builder /app/card*.png /app/
COPY --from=builder /app/server.js /app/

ENV PORT=80
ENV BUGS_DIR=/data/bugs
VOLUME /data/bugs
EXPOSE 80
CMD ["node", "server.js"]
