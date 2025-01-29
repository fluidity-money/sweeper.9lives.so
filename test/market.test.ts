import { ethers } from "ethers";
import { MockInfraMarket__factory, MockInfraMarket } from "../types/contracts";
import { InfraMarketHandler } from "../service/infra-market-handler";
import { TxQueue } from "../service/tx-queue";
import { Config } from "../types/config";
import { InfraMarketState } from "../types/market";
import assert from "assert";
import { describe, it, before, beforeEach } from "mocha";
import { BatchSweeper } from "../types/contracts/BatchSweeper";
import { BatchSweeper__factory } from "../types/contracts/factories/BatchSweeper__factory";
import { IInfraMarket } from "../types/contracts/IInfraMarket";
import sinon from "sinon";
import { AsyncNonceWallet, sleep } from "../service/utils";
import {
  TypedContractEvent,
  TypedDeferredTopicFilter,
  type TypedContractMethod,
} from "../types/contracts/common";
import { createCommitment } from "./test-utils";
import { MockInfraMarketInterface } from "../types/contracts/MockInfraMarket";

const ONE_DAY = 24 * 60 * 60;
const TWO_DAYS = 2 * ONE_DAY;
const FOUR_DAYS = 4 * ONE_DAY;

const ANVIL_RPC_URL = "http://localhost:8545";
const ANVIL_WSS_URL = "ws://localhost:8545";
const ANVIL_ACTOR_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);
const asyncActor = new AsyncNonceWallet(ANVIL_ACTOR_PRIVATE_KEY, provider);

const now = (provider: ethers.Provider) =>
  provider.getBlock("pending").then((block) => block!.timestamp);

const advanceBlockTimestamp = async (
  provider: ethers.JsonRpcProvider,
  seconds: number
) => {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
};

const waitStatusOrTimeout = async (
  market: MockInfraMarket,
  tradingAddr: string,
  status?: InfraMarketState //undefined means escaped
) => {
  // We can't rely on system timers in testing environment
  let timePassed = 0;
  while (true) {
    await sleep(200);
    // Roughly
    timePassed += 200;

    if (timePassed > 5000) {
      return false;
    }

    if (!status) {
      const escaped = await market.campaign_has_escaped(tradingAddr);
      if (escaped) {
        return true;
      }
      continue;
    }

    const state = await market.status(tradingAddr);
    if (Number(state[0]) === status) {
      return true;
    }
  }
};

const waitEmitOrTimeout = async (
  market: MockInfraMarket,
  wssProvider: ethers.WebSocketProvider,
  filter: TypedDeferredTopicFilter<TypedContractEvent<any, any, any>>
) => {
  let timePassed = 0;
  let emitted = false;
  market.connect(wssProvider).on(filter, () => {
    emitted = true;
  });

  while (!emitted) {
    await sleep(200);
    timePassed += 200;

    if (timePassed > 3000) {
      return false;
    }
  }

  return true;
};

const waitCondition = async <A extends any[], R>(
  getter: TypedContractMethod<A, R, "view">,
  condition: (value: R) => boolean,
  ...args: A
) => {
  let timePassed = 0;
  while (true) {
    await sleep(200);
    timePassed += 200;

    if (timePassed > 3000) {
      return false;
    }

    const value = await getter(...((args as any) ?? []));
    if (condition(value)) {
      return true;
    }
  }
};

const setTimestamp = async (
  provider: ethers.JsonRpcProvider,
  timestamp: number
) => {
  await provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await provider.send("evm_mine", []);
};

describe("InfraMarket Integration Tests", function () {
  this.timeout(0);
  let mockInfraMarket: MockInfraMarket;
  let batchSweeper: BatchSweeper;
  let marketHandler: InfraMarketHandler;
  let txQueue: TxQueue;
  let wssProvider: ethers.WebSocketProvider;
  let clock: sinon.SinonFakeTimers;
  let snapshot: number;

  const config: Config = {
    RPC_URL: ANVIL_RPC_URL,
    WSS_URL: ANVIL_WSS_URL,
    INFRA_MARKET_ADDRESS: "",
    BATCH_SWEEPER_ADDRESS: "",
    ACTOR_PRIVATE_KEY: ANVIL_ACTOR_PRIVATE_KEY,
    GAS_RATIO: 1n,
    CONFIRMATIONS: 1,
    RETRY_INTERVAL: 1000,
  };

  before(async function () {
    await asyncActor.init();
  });

  beforeEach(async function () {
    await provider.send("evm_mine", []);

    clock = sinon.useFakeTimers({
      toFake: ["setTimeout"],
      shouldAdvanceTime: true,
    });

    wssProvider = new ethers.WebSocketProvider(ANVIL_WSS_URL);

    mockInfraMarket = await new MockInfraMarket__factory(asyncActor).deploy();
    batchSweeper = await new BatchSweeper__factory(asyncActor).deploy();

    await mockInfraMarket.ctor(
      asyncActor.address,
      asyncActor.address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address
    );

    config.INFRA_MARKET_ADDRESS = mockInfraMarket.target as string;
    config.BATCH_SWEEPER_ADDRESS = batchSweeper.target as string;

    txQueue = new TxQueue(config, asyncActor);

    marketHandler = new InfraMarketHandler(
      mockInfraMarket as unknown as IInfraMarket,
      batchSweeper,
      wssProvider,
      txQueue,
      config
    );
  });

  afterEach(async function () {
    marketHandler.destroy();
    clock.restore();
    txQueue.flush();
  });

  // after(() => process.exit(0));

  describe("Transition over initialization", () => {
    it("escape immediately", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const launchTime = await now(provider);
      const callDeadlineDuration = 3600;
      const callDeadline = launchTime + callDeadlineDuration;

      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await advanceBlockTimestamp(provider, callDeadlineDuration + 1);

      await marketHandler.init();

      const escaped = await waitStatusOrTimeout(mockInfraMarket, tradingAddr);

      assert(escaped);
    });

    it("escape after deadline", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const launchTime = await now(provider);
      const callDeadlineDuration = 3600;
      const callDeadline = launchTime + callDeadlineDuration;

      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await marketHandler.init();

      await advanceBlockTimestamp(provider, callDeadlineDuration + 1);

      clock.tick((callDeadlineDuration + 1) * 1000);
      await Promise.resolve();

      const escaped = await waitStatusOrTimeout(mockInfraMarket, tradingAddr);

      assert(escaped);
    });

    it("close immediately", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const registerTime = (await now(provider)) + 100;
      const launchTime = registerTime + 100;
      const callDeadlineDuration = 3600;
      const callDeadline = launchTime + callDeadlineDuration;

      await setTimestamp(provider, registerTime);
      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await setTimestamp(provider, launchTime + 1);

      await mockInfraMarket.call(
        tradingAddr,
        "0x0000000000000001",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, TWO_DAYS + 1);

      const emitAssert = waitEmitOrTimeout(
        mockInfraMarket,
        wssProvider,
        mockInfraMarket.filters.InfraMarketClosed()
      );
      await marketHandler.init();

      assert(await emitAssert);
    });

    it("close after deadline", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const registerTime = (await now(provider)) + 1;
      const launchTime = registerTime + 3600;
      const callDeadline = registerTime + 3600 * 2;

      await setTimestamp(provider, registerTime);
      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await setTimestamp(provider, launchTime + 1);

      await mockInfraMarket.call(
        tradingAddr,
        "0x0000000000000001",
        asyncActor.address
      );

      const [_, remaining] = await mockInfraMarket.status(tradingAddr);
      await marketHandler.init();

      const emitClose = waitEmitOrTimeout(
        mockInfraMarket,
        wssProvider,
        mockInfraMarket.filters.InfraMarketClosed()
      );

      await advanceBlockTimestamp(provider, Number(remaining) + 3);
      clock.tick((Number(remaining) + 3) * 1000);

      assert(await emitClose);
    });

    it("declare immediately", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const registerTime = (await now(provider)) + 3600;
      const launchTime = registerTime + 3600;
      const callDeadline = registerTime + 3600 * 2;

      await setTimestamp(provider, registerTime);
      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await setTimestamp(provider, launchTime + 1);
      await mockInfraMarket.call(
        tradingAddr,
        "0x0000000000000001",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, ONE_DAY);
      await mockInfraMarket.whinge(
        tradingAddr,
        "0x0000000000000002",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, ONE_DAY);
      const outcome = "0x0000000000000001";
      const seed = "0x1234567890abcdef";
      const commitment = createCommitment(asyncActor, outcome, seed);
      await mockInfraMarket.predict(tradingAddr, commitment);

      await advanceBlockTimestamp(provider, TWO_DAYS);

      await mockInfraMarket.reveal(
        tradingAddr,
        asyncActor.address,
        outcome,
        seed
      );

      await advanceBlockTimestamp(provider, FOUR_DAYS);
      await marketHandler.init();

      const currentEpoch = await mockInfraMarket.cur_epochs(tradingAddr);

      const declared = await waitCondition(
        mockInfraMarket.epochs,
        (e) => (e as any).campaign_winner_set,
        tradingAddr,
        currentEpoch
      );

      assert(declared);
    });

    it("declare after revealing", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const registerTime = (await now(provider)) + 3600;
      const launchTime = registerTime + 3600;
      const callDeadline = registerTime + 3600 * 2;

      await setTimestamp(provider, registerTime);
      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await setTimestamp(provider, launchTime + 1);
      await mockInfraMarket.call(
        tradingAddr,
        "0x0000000000000001",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, ONE_DAY);
      await mockInfraMarket.whinge(
        tradingAddr,
        "0x0000000000000002",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, ONE_DAY);
      const outcome = "0x0000000000000001";
      const seed = "0x1234567890abcdef";
      const commitment = createCommitment(asyncActor, outcome, seed);
      await mockInfraMarket.predict(tradingAddr, commitment);

      await advanceBlockTimestamp(provider, TWO_DAYS);
      await marketHandler.init();

      await mockInfraMarket.reveal(
        tradingAddr,
        asyncActor.address,
        outcome,
        seed
      );

      await advanceBlockTimestamp(provider, FOUR_DAYS);
      clock.tick(FOUR_DAYS * 1000);
      const currentEpoch = await mockInfraMarket.cur_epochs(tradingAddr);

      const declared = await waitCondition(
        mockInfraMarket.epochs,
        (e) => (e as any).campaign_winner_set,
        tradingAddr,
        currentEpoch
      );

      assert(declared);
    });

    //TBD
    it("sweep immediately", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const registerTime = (await now(provider)) + 3600;
      const launchTime = registerTime + 3600;
      const callDeadline = registerTime + 3600 * 2;

      await setTimestamp(provider, registerTime);
      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await setTimestamp(provider, launchTime + 1);
      await mockInfraMarket.call(
        tradingAddr,
        "0x0000000000000001",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, ONE_DAY);
      await mockInfraMarket.whinge(
        tradingAddr,
        "0x0000000000000002",
        asyncActor.address
      );

      await mockInfraMarket.predict(
        tradingAddr,
        createCommitment(asyncActor, "0x0000000000000001", "0x1234567890abcdef")
      );
      await advanceBlockTimestamp(provider, TWO_DAYS + 1);
      await mockInfraMarket.reveal(
        tradingAddr,
        asyncActor.address,
        "0x0000000000000001",
        "0x1234567890abcdef"
      );

      await advanceBlockTimestamp(provider, TWO_DAYS);
      await marketHandler.init();

      const currentEpoch = await mockInfraMarket.cur_epochs(tradingAddr);

      const sweeped = await waitCondition(
        mockInfraMarket.epochs,
        (e) => (e as any).sweeped,
        tradingAddr,
        currentEpoch
      );
    });
  });
});
