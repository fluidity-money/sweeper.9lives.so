import { ethers, Log } from "ethers";
import { BatchSweeper } from "../types/contracts/BatchSweeper";
import { IInfraMarket } from "../types/contracts/IInfraMarket";
import {
  ActiveMarkets,
  ActiveLUT,
  EventLUT,
  InfraMarketState,
} from "../types/market";
import {
  TypedContractEvent,
  TypedLogDescription,
} from "../types/contracts/common";
import {
  CallMadeEvent,
  CommitmentRevealedEvent,
  InfraMarketClosedEvent,
  MarketCreated2Event,
} from "../types/contracts/IInfraMarket";
import { TxQueue } from "./tx-queue";
import { Logger } from "./logger";
import { sleep } from "./utils";
import { Config } from "../types/config";
import { POOLING_INTERVAL, SET_TIMEOUT_THRESHOLD } from "./const";

export class InfraMarketHandler extends Logger {
  #activeMarkets: ActiveMarkets = {};
  #activeEventLUT: ActiveLUT = {};

  constructor(
    private infraMarket: IInfraMarket,
    private batchSweeper: BatchSweeper,
    private wssProvider: ethers.WebSocketProvider,
    private txQueue: TxQueue,
    private config: Config
  ) {
    super();
  }

  public init = async () => {
    await this.#initEventLUT();
    await this.#filterMarkets();
  };

  #marketStatus = async (tradingAddr: string) => {
    const statusReq = this.infraMarket.status(tradingAddr);

    const status = await statusReq.catch(this.error);

    return status
      ? {
          state: Number(status[0]) as InfraMarketState,
          remaining: Number(status[1]),
        }
      : undefined;
  };

  #filterMarkets = async () => {
    const marketsQuery = this.infraMarket.queryFilter(
      this.infraMarket.filters.MarketCreated2()
    );

    const markets = await marketsQuery.catch(this.error);
    if (!markets) {
      this.error("Error during markets query");
      await sleep(this.config.RETRY_INTERVAL);
      setImmediate(this.#filterMarkets);
      return;
    }

    for (const market of markets) {
      const status = await this.#marketStatus(market.args.tradingAddr);
      if (!status) {
        this.error("Error during market status request");
        await sleep(this.config.RETRY_INTERVAL);
        setImmediate(this.#filterMarkets);
        continue;
      }

      const { state, remaining } = status;

      switch (state) {
        case InfraMarketState.Callable:
          if (remaining === 0) {
            this.#escape(market.args.tradingAddr);
          } else {
            this.#scheduleEscape(market.args.tradingAddr, remaining);
          }
          break;

        case InfraMarketState.Whinging:
          this.#scheduleClose(market.args.tradingAddr);
          break;

        case InfraMarketState.Closable:
          // TODO: closable and close are the same, check that campaign not closed based on epoches management
          this.#close(market.args.tradingAddr);
          break;

        case InfraMarketState.Revealing:
          this.#scheduleDeclare(market.args.tradingAddr);
          break;

        case InfraMarketState.Declarable:
          await this.#declare(market.args.tradingAddr);
          break;

        case InfraMarketState.Sweeping:
          this.#sweep(market.args.tradingAddr);
          break;
      }
    }
  };

  #initEventLUT = async () => {
    for (const [filter, handler] of this.#eventLUT) {
      const topics = ethers.id(filter.fragment.format());
      this.#activeEventLUT[topics] = handler;
    }

    await this.wssProvider.on(
      { address: this.infraMarket.target },
      (log: Log) => {
        if (this.#activeEventLUT[log.topics[0]]) {
          return this.#activeEventLUT[log.topics[0]]!(log);
        }
      }
    );
  };

  parseLog = (log: Log) =>
    this.infraMarket.interface.parseLog(
      log
    )! as TypedLogDescription<TypedContractEvent>;

  #onCreate = async (log: Log) => {
    const createdEvt: MarketCreated2Event.LogDescription = this.parseLog(log);

    const status = await this.#marketStatus(createdEvt.args.tradingAddr);

    if (status) {
      this.#scheduleEscape(createdEvt.args.tradingAddr, status.remaining);
    }
  };

  #onCall = (log: Log) => {
    const callEvt: CallMadeEvent.LogDescription = this.parseLog(log);

    this.#scheduleClose(callEvt.args.tradingAddr);
  };

  #onRemove = (log: Log) => {
    const removeEvt: InfraMarketClosedEvent.LogDescription = this.parseLog(log);
    delete this.#activeMarkets[removeEvt.args.tradingAddr];
  };

  #onReveal = (log: Log) => {
    const revealEvt: CommitmentRevealedEvent.LogDescription =
      this.parseLog(log);

    this.#scheduleDeclare(revealEvt.args.trading);
  };

  #declare = async (tradingAddr: string) => {
    const outcomes = await this.infraMarket
      .queryFilter(this.infraMarket.filters.CommitmentRevealed(tradingAddr))
      .then((logs) => logs.map((l) => l.args.outcome));

    this.txQueue.push(
      this.infraMarket.declare,
      tradingAddr,
      outcomes,
      this.txQueue.actor.address
    );

    this.#scheduleSweep(tradingAddr);
  };

  #close = (tradingAddr: string) => {
    this.txQueue.push(
      this.infraMarket.close,
      tradingAddr,
      this.txQueue.actor.address
    );
  };

  #sweep = async (tradingAddr: string) => {
    const declaredWinner = await this.infraMarket.winner(tradingAddr);

    const reveals = await this.infraMarket
      .queryFilter(this.infraMarket.filters.CommitmentRevealed(tradingAddr))
      .then((logs) => logs.map((l) => l.args));

    const victims = reveals.filter(
      (reveal) => reveal.outcome !== declaredWinner
    );

    const epochNo = await this.infraMarket.epochNumber(tradingAddr);

    const victimsAddresses = victims.map((victim) => victim.revealer);

    this.txQueue.push(
      this.batchSweeper.sweepBatch,
      this.infraMarket.target,
      tradingAddr,
      epochNo,
      victimsAddresses,
      this.txQueue.actor.address
    );
  };

  #escape = (tradingAddr: string) => {
    this.txQueue.push(this.infraMarket.escape, tradingAddr);
  };

  #scheduleSweep = async (tradingAddr: string) => {
    while (true) {
      const s = await this.#marketStatus(tradingAddr);

      if (s?.state === InfraMarketState.Sweeping) {
        await this.#sweep(tradingAddr);
        break;
      }

      await sleep(POOLING_INTERVAL);
    }
  };

  #scheduleDeclare = async (tradingAddr: string) => {
    if (!this.#activeMarkets[tradingAddr]) {
      this.#activeMarkets[tradingAddr] = {};
    }

    clearTimeout(this.#activeMarkets[tradingAddr]?.closeTimer);

    const s = await this.#marketStatus(tradingAddr);

    if (s?.state === InfraMarketState.Revealing) {
      clearTimeout(this.#activeMarkets[tradingAddr]?.declareTimer);
      this.#activeMarkets[tradingAddr].declareTimer = setTimeout(
        () => this.#declare(tradingAddr),
        s.remaining * 1000 + SET_TIMEOUT_THRESHOLD
      );
    }
  };

  #scheduleClose = async (tradingAddr: string) => {
    if (!this.#activeMarkets[tradingAddr]) {
      this.#activeMarkets[tradingAddr] = {};
    }

    clearTimeout(this.#activeMarkets[tradingAddr]?.escapeTimer);

    const s = await this.#marketStatus(tradingAddr);

    if (s?.state === InfraMarketState.Whinging) {
      clearTimeout(this.#activeMarkets[tradingAddr]?.closeTimer);

      this.#activeMarkets[tradingAddr].closeTimer = setTimeout(
        () => {
          this.#close(tradingAddr);
        },
        s.remaining * 1000 + SET_TIMEOUT_THRESHOLD
      );
    }
  };

  #scheduleEscape = (tradingAddr: string, remaining: number) => {
    if (!this.#activeMarkets[tradingAddr]) {
      this.#activeMarkets[tradingAddr] = {};
    }

    clearTimeout(this.#activeMarkets[tradingAddr]?.escapeTimer);
    this.#activeMarkets[tradingAddr].escapeTimer = setTimeout(
      () => this.#escape(tradingAddr),
      remaining * 1000 + SET_TIMEOUT_THRESHOLD
    );
  };

  readonly #eventLUT: EventLUT = [
    [this.infraMarket.filters.MarketCreated2(), this.#onCreate],
    [this.infraMarket.filters.CallMade(), this.#onCall],
    [this.infraMarket.filters.InfraMarketClosed(), this.#onRemove],
    [this.infraMarket.filters.CampaignEscaped(), this.#onRemove],
    [this.infraMarket.filters.CommitmentRevealed(), this.#onReveal],
  ];

  destroy = () => {
    this.wssProvider.destroy();
    for (const market of Object.keys(this.#activeMarkets)) {
      clearTimeout(this.#activeMarkets[market]?.escapeTimer);
      clearTimeout(this.#activeMarkets[market]?.closeTimer);
    }
  };
}
