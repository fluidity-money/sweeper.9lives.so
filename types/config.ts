export type Config = {
  RPC_URL: string;
  WSS_URL: string;
  INFRA_MARKET_ADDRESS: string;
  BATCH_SWEEPER_ADDRESS: string;
  ACTOR_PRIVATE_KEY: string;
  GAS_RATIO: bigint;
  CONFIRMATIONS: number;
  RETRY_INTERVAL: number;
};
