# Sweeper - 9Lives Protocol Automation

Sweeper is a service that automates certain on-chain logic for the 9Lives protocol, an Arbitrum Stylus smart contract ecosystem using a factory/pair pattern. It helps manage events like call, whinge, declare, close, sweep, and escape, reducing manual overhead.

## Main Components

• Infra Market Handler: An event-driven class that listens for on-chain events (e.g., MarketCreated2, CallMade, CommitmentRevealed) and orchestrates state transitions for campaigns.  
• TxQueue: A queue system that batches and sends transactions to the chain (e.g., close, declare, sweepBatch).  
• BatchSweeper : An optional contract-based approach to mass-slashing incorrectly betting users without multiple sequential calls.

## Usage

-

#### TODO:

- [ ] Solve sweeping epoch quering
- [ ] Rewrite tests on forge using ffi
- [ ] Prepare Dockerfile
- [ ] Extend Usage section of Readme

## License

See LICENSE file for details.
