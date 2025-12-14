FROM grafana/tempo:latest@sha256:187d159a30fc56a505bfaaac3e949024b0d900c59188cc6bb5619437f3f40f31
COPY tempo.yaml /etc/tempo.yaml
# Create necessary directories and set ownership for Tempo user (usually 10001)
RUN mkdir -p /var/lib/tempo/wal/blocks && chown -R 10001:10001 /var/lib/tempo
