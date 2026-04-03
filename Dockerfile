# ── Stage 1: Clone ───────────────────────────────────────────
FROM alpine/git AS builder

WORKDIR /app
ARG CACHEBUST=0
ARG GIT_REF=main
RUN echo "bust=${CACHEBUST}" \
    && git clone --depth 1 --branch ${GIT_REF} --single-branch \
       https://github.com/redswoop/jigsaw.git .

# ── Stage 2: Production (static nginx) ──────────────────────
FROM nginx:alpine

COPY --from=builder /app/index.html /usr/share/nginx/html/
COPY --from=builder /app/card1.png /usr/share/nginx/html/
COPY --from=builder /app/card2.png /usr/share/nginx/html/
COPY --from=builder /app/card3.png /usr/share/nginx/html/

EXPOSE 80
