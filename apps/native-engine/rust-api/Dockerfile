FROM rust:1.95-bookworm AS build

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY apps/native-engine/rust-api/Cargo.toml apps/native-engine/rust-api/Cargo.toml
COPY apps/native-engine/rust-worker/Cargo.toml apps/native-engine/rust-worker/Cargo.toml
COPY apps/native-engine/rust-api apps/native-engine/rust-api
COPY apps/native-engine/rust-worker apps/native-engine/rust-worker
RUN cargo build --release -p email-hub-api

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/email-hub-api /usr/local/bin/email-hub-api

ENV API_PORT=8080
EXPOSE 8080
CMD ["email-hub-api"]
