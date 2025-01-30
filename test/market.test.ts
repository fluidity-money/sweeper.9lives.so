import { ethers } from "ethers";
import { MockInfraMarket__factory, MockInfraMarket } from "../types/contracts";
import { InfraMarketHandler } from "../service/infra-market-handler";
import { TxQueue } from "../service/tx-queue";
import { Config } from "../types/config";
import { describe, it, before, beforeEach } from "mocha";
import { BatchSweeper } from "../types/contracts/BatchSweeper";
import { BatchSweeper__factory } from "../types/contracts/factories/BatchSweeper__factory";
import { IInfraMarket } from "../types/contracts/IInfraMarket";
import assert from "assert";
import sinon from "sinon";

import {
  advanceBlockTimestamp,
  ANVIL_RPC_URL,
  ANVIL_WSS_URL,
  asyncActor,
  createCommitment,
  FOUR_DAYS,
  now,
  ONE_DAY,
  provider,
  setTimestamp,
  TWO_DAYS,
  USERS,
  waitCondition,
  waitEmitOrTimeout,
  waitStatusOrTimeout,
} from "./utils";

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
    const commitment = createCommitment(asyncActor.address, outcome, seed);
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
    const commitment = createCommitment(asyncActor.address, outcome, seed);
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

  it("sweep immediately", async function () {
    const tradingAddr = ethers.Wallet.createRandom().address;
    const registerTime = (await now(provider)) + 3600;
    const launchTime = registerTime + 3600;
    const callDeadline = registerTime + 3600 * 2;

    const winner = "0x0000000000000001";
    const loser = "0x0000000000000002";
    const seed = "0x1234567890abcdef";

    const victim = USERS[1];
    const legitUser = USERS[2];

    await setTimestamp(provider, registerTime);
    clock.tick(registerTime * 1000 - Date.now());
    await Promise.resolve();
    await mockInfraMarket.register(
      tradingAddr,
      ethers.hexlify(ethers.randomBytes(32)),
      launchTime,
      callDeadline
    );

    await setTimestamp(provider, launchTime + 1);
    await mockInfraMarket.call(tradingAddr, winner, asyncActor.address);

    await advanceBlockTimestamp(provider, ONE_DAY);
    await mockInfraMarket.whinge(tradingAddr, loser, asyncActor.address);

    await advanceBlockTimestamp(provider, ONE_DAY);

    await mockInfraMarket
      .connect(victim)
      .predict(tradingAddr, createCommitment(victim.address, loser, seed));

    await mockInfraMarket
      .connect(legitUser)
      .predict(tradingAddr, createCommitment(legitUser.address, winner, seed));

    await advanceBlockTimestamp(provider, TWO_DAYS + 1);
    await mockInfraMarket
      .connect(victim)
      .reveal(tradingAddr, victim.address, loser, seed);

    await mockInfraMarket
      .connect(legitUser)
      .reveal(tradingAddr, legitUser.address, winner, seed);

    await advanceBlockTimestamp(provider, TWO_DAYS + 1);
    await mockInfraMarket.declare(
      tradingAddr,
      [winner, loser],
      asyncActor.address
    );

    await marketHandler.init();

    const sweeped = await waitEmitOrTimeout(
      mockInfraMarket,
      wssProvider,
      mockInfraMarket.filters.MockSweeped()
    );

    assert(sweeped);
  });

  it("sweep after declare", async function () {
    const tradingAddr = ethers.Wallet.createRandom().address;
    const registerTime = (await now(provider)) + 3600;
    const launchTime = registerTime + 3600;
    const callDeadline = registerTime + 3600 * 2;

    const winner = "0x0000000000000001";
    const loser = "0x0000000000000002";
    const seed = "0x1234567890abcdef";

    const victim = USERS[1];
    const legitUser = USERS[2];

    await setTimestamp(provider, registerTime);
    await mockInfraMarket.register(
      tradingAddr,
      ethers.hexlify(ethers.randomBytes(32)),
      launchTime,
      callDeadline
    );

    await setTimestamp(provider, launchTime + 1);
    await mockInfraMarket.call(tradingAddr, winner, asyncActor.address);

    await advanceBlockTimestamp(provider, ONE_DAY);
    await mockInfraMarket.whinge(tradingAddr, loser, asyncActor.address);

    await advanceBlockTimestamp(provider, ONE_DAY);

    await mockInfraMarket
      .connect(victim)
      .predict(tradingAddr, createCommitment(victim.address, loser, seed));

    await mockInfraMarket
      .connect(legitUser)
      .predict(tradingAddr, createCommitment(legitUser.address, winner, seed));

    await advanceBlockTimestamp(provider, TWO_DAYS + 1);
    await mockInfraMarket
      .connect(victim)
      .reveal(tradingAddr, victim.address, loser, seed);

    await mockInfraMarket
      .connect(legitUser)
      .reveal(tradingAddr, legitUser.address, winner, seed);

    await marketHandler.init();

    await advanceBlockTimestamp(provider, TWO_DAYS + 1);
    await mockInfraMarket.declare(
      tradingAddr,
      [winner, loser],
      asyncActor.address
    );

    const sweeped = await waitEmitOrTimeout(
      mockInfraMarket,
      wssProvider,
      mockInfraMarket.filters.MockSweeped()
    );

    assert(sweeped);
  });
});
