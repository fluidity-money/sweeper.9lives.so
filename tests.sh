#!/bin/bash
forge build
./typegen.sh

start_anvil() {
    pkill -f anvil

    anvil --port 8545 > /dev/null 2>&1 &
    ANVIL_PID=$!

    while ! lsof -i:8545; do
        sleep 0.3
    done
}

start_anvil

npm run test

kill $ANVIL_PID