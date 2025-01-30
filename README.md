# Sweeper - 9Lives Protocol Automation Service

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Automated transaction management system for 9Lives protocol campaigns. Handles critical lifecycle operations including position closing, dispute resolution, and batch slashing on Arbitrum Stylus.

## Features

### Core Components

- **Event Orchestrator**  
  Real-time monitoring of protocol events (`MarketCreated2`, `CallMade`, `CommitmentRevealed`) with state machine transitions
- **Transaction Pipeline**  
  Gas-optimized batched transaction processing (`close`, `declare`, `sweepBatch`)
- **Mass Action Engine**  
  Parallelized settlement system for large-scale position management (optional)

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) (forge >= 0.2.0, anvil >= 0.2.0) for contract compilation and local testnet
- Node.js v18+

## Quick Start for deployment

```bash
# Install dependencies
npm install

# Configuration setup
cp .env.example .env  # Update with your credentials

# Build contracts and generate TypeScript types
forge build
./typegen.sh  # Generates TypeChain bindings for contracts

# Build project
npm run build

# Start service
npm start
```

## Running in docker

1. Fill environment values:

   ```bash
   cp .env.example .env
   ```

2. Build Docker image:

   ```bash
   docker build -t sweeper .
   ```

3. Run service in detached mode:
   ```bash
   docker run -d sweeper
   ```

## Configuration

#### BatchSweeper deployments

| Network | Address                                    |
| ------- | ------------------------------------------ |
| Testnet | 0x17309B2d1BE2835C9c15631A3bD90Ce8bEf1F5F8 |
| Mainnet | 0x7771Af089C9c06689743529da48744fC9AFbB89D |

### Environment Variables

```ini
# Required
RPC_URL="superposition_rpc_endpoint"
WSS_URL="superposition_websocket_endpoint"
INFRA_MARKET_ADDRESS="0x...market_address"
BATCH_SWEEPER_ADDRESS="0x...batch_sweeper_address"
ACTOR_PRIVATE_KEY="operator_wallet_key"

# Transaction settings
GAS_RATIO=20                                     # Extra gas percent for transactions
CONFIRMATIONS=5                                  # Required block confirmations
RETRY_INTERVAL=2000                             # Retry interval in milliseconds
MAX_RETRIES=3                                   # Maximum number of retry attempts

# Health check settings
HEARTBEAT_URL=""                                # Health check endpoint URL
HEARTBEAT_INTERVAL=60000                        # Health check interval in milliseconds
```

## Testing

To run tests using the local Anvil node:

```bash
# Make the test script executable
chmod +x tests.sh

# Run tests
./tests.sh
```

The test script will:

1. Build contracts using Forge
2. Generate TypeChain types
3. Start a local Anvil node
4. Run the test suite
5. Clean up the Anvil process

## Available Commands

```bash
# Build TypeScript files
npm run build

# Start the service
npm start

# Run tests directly (without Anvil setup)
npm test
```

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

## Roadmap

- [x] Docker containerization
- [x] Extend testing
- [ ] Add epoches management in case of campaign reopening
