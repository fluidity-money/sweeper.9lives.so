import {
  ContractTransactionResponse,
  ethers,
  TransactionRequest,
  TransactionResponse,
} from "ethers";
import { Config } from "./types/config";

const mustEnv = <T>(env: string): T => {
  if (process.env[env] === undefined) {
    throw new Error(`Environment variable ${env} is not set`);
  }

  return process.env[env] as T;
};

export const getConfig = (): Config => ({
  RPC_URL: mustEnv("RPC_URL"),
  WSS_URL: mustEnv("WSS_URL"),
  INFRA_MARKET_ADDRESS: mustEnv("INFRA_MARKET_ADDRESS"),
  BATCH_SWEEPER_ADDRESS: mustEnv("BATCH_SWEEPER_ADDRESS"),
  ACTOR_PRIVATE_KEY: mustEnv("ACTOR_PRIVATE_KEY"),
  GAS_RATIO: BigInt(Number(process.env.GAS_RATIO)) || 20n,
  CONFIRMATIONS: Number(process.env.CONFIRMATIONS) || 1,
  RETRY_INTERVAL: Number(process.env.RETRY_INTERVAL) || 1000,
});

export class AsyncNonceWallet extends ethers.Wallet {
  private baseNonce = 0;
  private nonceOffset = 0;

  constructor(privateKey: string, provider: ethers.JsonRpcProvider) {
    super(privateKey, provider);
  }

  async initialize() {
    this.baseNonce = await this.provider!.getTransactionCount(
      this.address,
      "pending"
    );
  }

  sendTransaction(transaction: TransactionRequest) {
    transaction.nonce = this.baseNonce + this.nonceOffset;
    this.nonceOffset++;
    return super.sendTransaction(transaction);
  }
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitBlock =
  (confirmations: number) =>
  (tx: ContractTransactionResponse | TransactionResponse) =>
    tx.wait(confirmations);
