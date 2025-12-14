# Stage 1: Prepare directories with correct permissions
FROM alpine:latest as init
RUN mkdir -p /tempo-data/wal
RUN mkdir -p /tempo-data/blocks
# Tempo user is typically 10001
RUN chown -R 10001:10001 /tempo-data

# Stage 2: Final image
FROM grafana/tempo:latest
COPY tempo.yaml /etc/tempo.yaml
COPY --from=init --chown=10001:10001 /tempo-data /var/lib/tempo