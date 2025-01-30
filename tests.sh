#!/bin/bash

# Parse arguments
CONSOLE_FLAG=false
for arg in "$@"; do
    case $arg in
        --console)
            CONSOLE_FLAG=true
            shift
            ;;
    esac
done

forge build
./typegen.sh

start_anvil() {
    pkill -f anvil

    if [ "$CONSOLE_FLAG" = true ]; then
        RUST_LOG=node::console anvil --port 8545 --color always --silent &
    else
        anvil --port 8545 --color always --silent &
    fi
    ANVIL_PID=$!

    while ! lsof -i:8545; do
        sleep 0.3
    done
}

# Bypass anvil discrepancy of block.timestamp
start_anvil
npx mocha -r tsx test/market.test.ts --timeout 0
kill $ANVIL_PID

start_anvil
npx mocha -r tsx test/market-full-flow.test.ts --timeout 0
kill $ANVIL_PID
