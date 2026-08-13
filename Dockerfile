FROM rust:1.94.1-bookworm AS builder

WORKDIR /src
COPY rust-toolchain.toml Cargo.toml Cargo.lock ./
COPY apps ./apps
COPY crates ./crates
COPY migrations ./migrations

RUN cargo build --release -p daoyun-api --features infrastructure/s3

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --uid 10001 daoyun \
    && install -d -o daoyun -g daoyun /var/lib/daoyun/attachments

COPY --from=builder /src/target/release/daoyun-api /usr/local/bin/daoyun-api

USER daoyun
EXPOSE 3000
VOLUME ["/var/lib/daoyun/attachments"]

ENV DAOYUN_BIND_ADDR=0.0.0.0:3000 \
    DAOYUN_ATTACHMENT_ROOT=/var/lib/daoyun/attachments \
    RUST_LOG=info

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD curl --fail --silent http://127.0.0.1:3000/api/v1/health/live || exit 1

ENTRYPOINT ["/usr/local/bin/daoyun-api"]
