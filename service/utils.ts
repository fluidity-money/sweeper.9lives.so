import { ethers, TransactionRequest } from "ethers";
import { Config } from "../types/config";

const mustEnv = <T>(env: string): T => {
  if (process.env[env] === undefined) {
    throw new Error(`Environment variable ${env} is not set`);
  }

  return process.env[env] as T;
};

export const getConfig = (): Config => ({
  RPC_URL: process.env.SUPERPOSITION_RPC_URL!,
  WSS_URL: process.env.SUPERPOSITION_WSS_URL!,
  INFRA_MARKET_ADDRESS: process.env.INFRA_MARKET_IMPL!,
  BATCH_SWEEPER_ADDRESS: process.env.BATCH_SWEEPER_IMPL!,
  ACTOR_PRIVATE_KEY: process.env.PRIVATE_KEY!,
  GAS_RATIO: BigInt(process.env.GAS_RATIO || 1),
  CONFIRMATIONS: Number(process.env.CONFIRMATIONS || 1),
  RETRY_INTERVAL: Number(process.env.RETRY_INTERVAL || 1000),
  MAX_RETRIES: Number(process.env.MAX_RETRIES || 5),
});

export class AsyncNonceWallet extends ethers.Wallet {
  baseNonce = 0;
  nonceOffset = 0;

  async init() {
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
  (confirmations: number) => async (tx: ethers.TransactionResponse) => {
    const receipt = await tx.wait(confirmations);
    return receipt;
  };
