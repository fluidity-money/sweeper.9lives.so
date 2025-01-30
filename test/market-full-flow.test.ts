import assert from "assert";
import { ethers } from "ethers/lib.commonjs";
import { InfraMarketHandler } from "../service/infra-market-handler";
import { TxQueue } from "../service/tx-queue";
import { Config } from "../types/config";
import {
  MockInfraMarket,
  BatchSweeper,
  MockInfraMarket__factory,
  BatchSweeper__factory,
  IInfraMarket,
} from "../types/contracts";
import {
  ANVIL_RPC_URL,
  ANVIL_WSS_URL,
  USERS,
  asyncActor,
  provider,
  ONE_DAY,
  now,
  TWO_DAYS,
  setTimestamp,
  createCommitment,
  waitEmitOrTimeout,
} from "./utils";
import sinon from "sinon";

describe("InfraMarketHandler Integration Tests", function () {
  this.timeout(0);
  let mockInfraMarket: MockInfraMarket;
  let batchSweeper: BatchSweeper;
  let marketHandler: InfraMarketHandler;
  let txQueue: TxQueue;
  let wssProvider: ethers.WebSocketProvider;
  let clock: sinon.SinonFakeTimers;

  const config: Config = {
    RPC_URL: ANVIL_RPC_URL,
    WSS_URL: ANVIL_WSS_URL,
    INFRA_MARKET_ADDRESS: "",
    BATCH_SWEEPER_ADDRESS: "",
    ACTOR_PRIVATE_KEY: USERS[0].privateKey,
    GAS_RATIO: 1n,
    CONFIRMATIONS: 1,
    RETRY_INTERVAL: 1000,
    MAX_RETRIES: 1,
    HEARTBEAT_URL: "",
    HEARTBEAT_INTERVAL: 0,
  };

  before(async function () {
    await asyncActor.init();
  });

  after(async function () {
    process.exit(0);
  });

  beforeEach(async function () {
    await provider.send("evm_mine", []);

    clock = sinon.useFakeTimers({
      toFake: ["setInterval"],
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

  describe("Full flow", function () {
    it("full follow", async function () {
      const tradingAddr = ethers.Wallet.createRandom().address;

      const HALF_DAY = (ONE_DAY / 2) | 0;

      const registerTime = (await now(provider)) + ONE_DAY;

      const launchTime = registerTime + HALF_DAY;

      const escapeTime = registerTime + ONE_DAY * 2;

      const callTime = escapeTime - HALF_DAY;

      const whingeTime = callTime + ONE_DAY;

      const predictTime = whingeTime + ONE_DAY;

      const revealTime = predictTime + TWO_DAYS + 10;

      const declareTime = whingeTime + ONE_DAY * 4 + 10;

      const winner = "0x0000000000000001";
      const loser = "0x0000000000000002";
      const seed = "0x1234567890abcdef";

      const victim = USERS[1];
      const legitUser = USERS[2];

      await marketHandler.init();

      await setTimestamp(provider, registerTime);
      clock.tick(registerTime * 1000 - Date.now());
      await Promise.resolve();
      await mockInfraMarket.register(
        tradingAddr,
        ethers.hexlify(ethers.randomBytes(32)),
        launchTime,
        escapeTime
      );

      await setTimestamp(provider, callTime);
      clock.tick(callTime * 1000 - Date.now());
      await Promise.resolve();
      await mockInfraMarket.call(tradingAddr, winner, asyncActor.address);

      await setTimestamp(provider, whingeTime);
      clock.tick(whingeTime * 1000 - Date.now());
      await Promise.resolve();
      await mockInfraMarket.whinge(tradingAddr, loser, asyncActor.address);

      await setTimestamp(provider, predictTime);
      clock.tick(predictTime * 1000 - Date.now());
      await Promise.resolve();
      await mockInfraMarket
        .connect(victim)
        .predict(tradingAddr, createCommitment(victim.address, loser, seed));

      await mockInfraMarket
        .connect(legitUser)
        .predict(
          tradingAddr,
          createCommitment(legitUser.address, winner, seed)
        );

      await setTimestamp(provider, revealTime);
      clock.tick(revealTime * 1000 - Date.now());
      await Promise.resolve();
      await mockInfraMarket
        .connect(victim)
        .reveal(tradingAddr, victim.address, loser, seed);

      await mockInfraMarket
        .connect(legitUser)
        .reveal(tradingAddr, legitUser.address, winner, seed);

      await setTimestamp(provider, declareTime);
      clock.tick(declareTime * 1000 - Date.now());
      await Promise.resolve();

      const declared = await waitEmitOrTimeout(
        mockInfraMarket,
        wssProvider,
        mockInfraMarket.filters.Declared(),
        5000
      );

      assert(declared);

      const sweeped = await waitEmitOrTimeout(
        mockInfraMarket,
        wssProvider,
        mockInfraMarket.filters.MockSweeped(),
        5000
      );

      assert(sweeped);
    });
  });
});
