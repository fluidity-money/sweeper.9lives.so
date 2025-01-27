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

const TWO_DAYS = 2 * 24 * 60 * 60;
const FOUR_DAYS = 4 * 24 * 60 * 60;

const ANVIL_RPC_URL = "http://localhost:8545";
const ANVIL_WSS_URL = "ws://localhost:8545";
const ANVIL_ACTOR_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);
const asyncActor = new AsyncNonceWallet(ANVIL_ACTOR_PRIVATE_KEY, provider);

const now = (provider: ethers.Provider) =>
  provider.getBlock("latest").then((block) => block!.timestamp);

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

    if (timePassed > 3000) {
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

describe("InfraMarket Integration Tests", function () {
  this.timeout(0);
  let mockInfraMarket: MockInfraMarket;
  let batchSweeper: BatchSweeper;
  let marketHandler: InfraMarketHandler;
  let txQueue: TxQueue;
  let clock: sinon.SinonFakeTimers;

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
    clock = sinon.useFakeTimers({
      toFake: ["setTimeout"],
      shouldAdvanceTime: true,
    });

    const wssProvider = new ethers.WebSocketProvider(ANVIL_WSS_URL);

    mockInfraMarket = await new MockInfraMarket__factory(asyncActor).deploy();
    batchSweeper = await new BatchSweeper__factory(asyncActor).deploy();

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

    await mockInfraMarket.ctor(
      asyncActor.address,
      asyncActor.address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address
    );
  });

  afterEach(async function () {
    await marketHandler.destroy();
    clock.restore();
    txQueue.flush();
  });

  after(() => process.exit(0));

  describe("Transision over initialization", () => {
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

      await advanceBlockTimestamp(provider, callDeadlineDuration);

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

      await advanceBlockTimestamp(provider, callDeadlineDuration);

      clock.tick(callDeadlineDuration * 1000);
      await Promise.resolve();

      const escaped = await waitStatusOrTimeout(mockInfraMarket, tradingAddr);

      assert(escaped);
    });

    it.only("close immediately", async function () {
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

      await mockInfraMarket.call(
        tradingAddr,
        "0x0000000000000001",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, TWO_DAYS + 1);
      await marketHandler.init();
      await sleep(2000);
      console.log(await mockInfraMarket.status(tradingAddr));
      const closed = await waitStatusOrTimeout(
        mockInfraMarket,
        tradingAddr,
        InfraMarketState.Closable
      );
      assert(closed);
    });
  });

  describe("Market state transitions", () => {
    it("declare after reveal period", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const launchTime = await now(provider);
      const callDeadlineDuration = 3600;
      const callDeadline = launchTime + callDeadlineDuration;
      const winner = "0x0000000000000001";

      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await marketHandler.init();

      await advanceBlockTimestamp(provider, 1);
      await mockInfraMarket.call(tradingAddr, winner, asyncActor.address);

      await advanceBlockTimestamp(provider, 1);
      await mockInfraMarket.whinge(
        tradingAddr,
        "0x0000000000000002",
        asyncActor.address
      );

      await advanceBlockTimestamp(provider, FOUR_DAYS + 1);
      clock.tick((FOUR_DAYS + 1) * 1000);
      await Promise.resolve();

      // Wait for declaration
      const declared = await waitStatusOrTimeout(
        mockInfraMarket,
        tradingAddr,
        InfraMarketState.Sweeping
      );
      assert(declared);

      const finalWinner = await mockInfraMarket.winner(tradingAddr);
      assert.equal(finalWinner, winner);
    });

    it("sweep after declaration", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;
      const launchTime = await now(provider);
      const callDeadlineDuration = 3600;
      const callDeadline = launchTime + callDeadlineDuration;
      const winner = "0x0000000000000001";
      const loser = "0x0000000000000002";

      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        callDeadline
      );

      await marketHandler.init();

      await advanceBlockTimestamp(provider, 1);
      await mockInfraMarket.call(tradingAddr, winner, asyncActor.address);

      await advanceBlockTimestamp(provider, 1);
      await mockInfraMarket.whinge(tradingAddr, loser, asyncActor.address);

      const victim = ethers.Wallet.createRandom();
      const seed = ethers.hexlify(ethers.randomBytes(32));
      const commitment = ethers.solidityPackedKeccak256(
        ["address", "bytes8", "uint256"],
        [victim.address, loser, seed]
      );

      await mockInfraMarket.predict(tradingAddr, commitment);

      await advanceBlockTimestamp(provider, TWO_DAYS + 1);
      await mockInfraMarket.reveal(tradingAddr, victim.address, loser, seed);

      await advanceBlockTimestamp(provider, TWO_DAYS);
      clock.tick(TWO_DAYS * 1000);
      await Promise.resolve();

      // Wait for sweeping state
      const sweeping = await waitStatusOrTimeout(
        mockInfraMarket,
        tradingAddr,
        InfraMarketState.Sweeping
      );
      assert(sweeping);

      const epochNo = await mockInfraMarket.epochNumber(tradingAddr);
      const sweepResult = await mockInfraMarket.sweep(
        tradingAddr,
        epochNo,
        victim.address,
        asyncActor.address
      );
      assert(sweepResult.hash);
    });
  });
});
