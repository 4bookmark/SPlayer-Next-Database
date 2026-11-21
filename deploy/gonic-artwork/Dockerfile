# syntax=docker/dockerfile:1
# 源码固定到已核对的 gonic 0.23.0 修订，禁止跟随 upstream HEAD。
FROM --platform=$BUILDPLATFORM golang:1.27-alpine3.24 AS builder
ARG TARGETOS
ARG TARGETARCH
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY
RUN apk add --no-cache git ca-certificates shared-mime-info
WORKDIR /src
RUN git init . \
 && git remote add origin https://github.com/sentriz/gonic.git \
 && git fetch --depth=1 origin 5ac9a8eb9b5cd73a170fbe584786fbcba40274da \
 && git checkout --detach 5ac9a8eb9b5cd73a170fbe584786fbcba40274da
COPY gonic-artwork.patch /tmp/gonic-artwork.patch
RUN git apply --check /tmp/gonic-artwork.patch && git apply /tmp/gonic-artwork.patch
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go test ./server/ctrlsubsonic/... \
 && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/ ./cmd/...

FROM alpine:3.24
LABEL org.opencontainers.image.source=https://github.com/sentriz/gonic \
      org.opencontainers.image.revision=5ac9a8eb9b5cd73a170fbe584786fbcba40274da \
      io.splayer.gonic.album-artworks=1
RUN apk add -U --no-cache ffmpeg mpv ca-certificates tzdata tini shared-mime-info
COPY --from=builder /out/* /usr/local/bin/
VOLUME ["/cache", "/data", "/music", "/podcasts"]
EXPOSE 80
ENV TZ=
ENV GONIC_DB_PATH=/data/gonic.db
ENV GONIC_LISTEN_ADDR=:80
ENV GONIC_MUSIC_PATH=/music
ENV GONIC_PODCAST_PATH=/podcasts
ENV GONIC_CACHE_PATH=/cache
ENV GONIC_PLAYLISTS_PATH=/playlists
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["gonic"]
