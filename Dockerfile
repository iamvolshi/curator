# Curator — K-record accountability layer for agent calls.
# No dependencies to install. Node 22.9 or newer, as in package.json engines.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY bin/ ./bin/
COPY cli/ ./cli/
COPY judge/ ./judge/
COPY provider/ ./provider/
COPY record/ ./record/
COPY test/ ./test/
COPY worker/ ./worker/
COPY wrapper/ ./wrapper/
COPY checks/ ./checks/
COPY records/ ./records/
COPY .env.example ./
# Offline checks only — no key and no network needed.
CMD ["npm", "test"]
