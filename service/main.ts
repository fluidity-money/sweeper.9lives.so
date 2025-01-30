import dotenv from "dotenv";
import { AsyncNonceWallet, getConfig } from "./utils";
import { ethers } from "ethers";
import { InfraMarketHandler } from "./infra-market-handler";
import { TxQueue } from "./tx-queue";
import { BatchSweeper__factory } from "../types/contracts/factories/BatchSweeper__factory";
import { IInfraMarket__factory } from "../types/contracts/factories/IInfraMarket__factory";
import { heartbeat } from "./heartbeat";

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

const asyncActor = new AsyncNonceWallet(config.ACTOR_PRIVATE_KEY, rpcProvider);

const txQueue = new TxQueue(config, asyncActor);

const infraMarketHandler = new InfraMarketHandler(
  infraMarketContract,
  batchSweeperContract,
  wssProvider,
  txQueue,
  config
);

const main = async () => {
  await asyncActor.init();
  await infraMarketHandler.init();
  // heartbeat(config);
};

main();
