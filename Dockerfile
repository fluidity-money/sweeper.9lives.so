FROM ghcr.io/foundry-rs/foundry AS builder

WORKDIR /sweeper

COPY lib /sweeper/lib
COPY contracts /sweeper/contracts
COPY foundry.toml /sweeper/foundry.toml

RUN forge build

FROM node:20.18-bullseye

WORKDIR /sweeper

COPY package.json package-lock.json ./
RUN npm i

COPY --from=builder /sweeper/out /sweeper/out

COPY typegen.sh /sweeper/typegen.sh
RUN sh typegen.sh

COPY service /sweeper/service
COPY types /sweeper/types
COPY tsconfig.json /sweeper/tsconfig.json

RUN npm run build

CMD ["node", "dist/service/main.js"]


