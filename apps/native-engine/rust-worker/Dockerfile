FROM rust:1.95-bookworm AS build

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY apps/native-engine/rust-api/Cargo.toml apps/native-engine/rust-api/Cargo.toml
COPY apps/native-engine/rust-worker/Cargo.toml apps/native-engine/rust-worker/Cargo.toml
COPY apps/native-engine/rust-api apps/native-engine/rust-api
COPY apps/native-engine/rust-worker apps/native-engine/rust-worker
RUN cargo build --release -p email-hub-worker

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/email-hub-worker /usr/local/bin/email-hub-worker

CMD ["email-hub-worker"]
