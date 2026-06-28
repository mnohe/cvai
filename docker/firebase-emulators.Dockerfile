FROM node:22-bookworm-slim

ARG FIREBASE_TOOLS_VERSION=14.18.0
ENV FIREBASE_EMULATORS_PATH=/opt/firebase/emulators

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jre-headless wget \
  && npm install -g firebase-tools@${FIREBASE_TOOLS_VERSION} \
  && mkdir -p "$FIREBASE_EMULATORS_PATH" \
  && firebase setup:emulators:firestore \
  && firebase setup:emulators:storage \
  && firebase setup:emulators:ui \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY docker/firebase.json ./firebase.json
COPY docker/storage.rules ./storage.rules
COPY docker/firestore.local.rules ./firestore.rules
COPY firestore.indexes.json ./

EXPOSE 4000 8080 9099 9199

CMD if [ -f /data/firebase-export-metadata.json ]; then \
      firebase emulators:start --only auth,firestore,storage --project "$FIREBASE_PROJECT_ID" --import=/data --export-on-exit=/data; \
    else \
      firebase emulators:start --only auth,firestore,storage --project "$FIREBASE_PROJECT_ID" --export-on-exit=/data; \
    fi
