import dotenv from "dotenv";
import { AsyncNonceWallet, getConfig } from "./utils";
import { ethers } from "ethers";
import { TxQueue } from "./tx-queue";
import { InfraMarketHandler } from "./infra-market-handler";
import {
  BatchSweeper__factory,
  IInfraMarket__factory,
} from "./types/contracts";

dotenv.config();

const config = getConfig();

const rpcProvider = new ethers.JsonRpcProvider(config.RPC_URL);
const wssProvider = new ethers.WebSocketProvider(config.WSS_URL);

const actor = new AsyncNonceWallet(config.ACTOR_PRIVATE_KEY, rpcProvider);

const infraMarketContract = IInfraMarket__factory.connect(
  config.INFRA_MARKET_ADDRESS,
  actor
);

const batchSweeperContract = BatchSweeper__factory.connect(
  config.BATCH_SWEEPER_ADDRESS,
  actor
);

const txQueue = new TxQueue(config);

const infraMarketHandler = new InfraMarketHandler(
  infraMarketContract,
  batchSweeperContract,
  wssProvider,
  txQueue,
  config
);

const main = async () => {
  await infraMarketHandler.init();
};

main();
