import { ethers, Log } from "ethers";
import { BatchSweeper, IInfraMarket } from "./types/contracts";
import {
  ActiveMarkets,
  ActiveLUT,
  EventLUT,
  InfraMarketState,
} from "./types/market";
import {
  TypedContractEvent,
  TypedDeferredTopicFilter,
  TypedLogDescription,
} from "./types/contracts/common";
import {
  CallMadeEvent,
  CommitmentRevealedEvent,
  InfraMarketClosedEvent,
  MarketCreated2Event,
} from "./types/contracts/IInfraMarket";
import { TxQueue } from "./tx-queue";
import { Logger } from "./logger";
import { sleep } from "./utils";
import { Config } from "./types/config";

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
    this.#initEventLUT();
    await this.#filterMarkets();
  };

  #marketStatus = async (tradingAddr: string) => {
    const statusReq = this.infraMarket.status(tradingAddr);

    const status = await statusReq.catch(this.error);

    return status
      ? {
          state: Number(status.currentState) as InfraMarketState,
          remaining: Number(status.secsRemaining),
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

      if (state === InfraMarketState.Closed) {
        continue;
      }

      if (state === InfraMarketState.Callable) {
        if (remaining === 0) {
          this.#escape(market.args.tradingAddr);
          continue;
        }

        this.#activeMarkets[market.args.tradingAddr].escapeTimer = setTimeout(
          () => this.#escape(market.args.tradingAddr),
          remaining * 1000
        );
      }
    }
  };

  #initEventLUT = async () => {
    for (const [filter, handler] of this.#eventLUT) {
      const f = (await filter.getTopicFilter()) as string[];
      this.#activeEventLUT[f[0]] = handler;
    }

    this.wssProvider.on({ address: this.infraMarket.target }, (log: Log) => {
      if (this.#activeEventLUT[log.topics[0]]) {
        return this.#activeEventLUT[log.topics[0]]!(log);
      }
    });
  };

  parseLog = (log: Log) =>
    this.infraMarket.interface.parseLog(
      log
    )! as TypedLogDescription<TypedContractEvent>;

  #onCreate = (log: Log) => {
    const createdEvt: MarketCreated2Event.LogDescription = this.parseLog(log);
    this.#activeMarkets[createdEvt.args.tradingAddr] = { outcomes: [] };
  };

  #onCall = (log: Log) => {
    const callEvt: CallMadeEvent.LogDescription = this.parseLog(log);
    if (!this.#activeMarkets[callEvt.args.tradingAddr]) {
      this.#activeMarkets[callEvt.args.tradingAddr] = {
        outcomes: [callEvt.args.winner],
      };
    } else {
      this.#activeMarkets[callEvt.args.tradingAddr].outcomes.push(
        callEvt.args.winner
      );
    }
    clearTimeout(this.#activeMarkets[callEvt.args.tradingAddr]?.escapeTimer);

    this.#scheduleClose(callEvt.args.tradingAddr);
  };

  #onRemove = (log: Log) => {
    const removeEvt: InfraMarketClosedEvent.LogDescription = this.parseLog(log);
    delete this.#activeMarkets[removeEvt.args.tradingAddr];
  };

  #onReveal = (log: Log) => {
    const revealEvt: CommitmentRevealedEvent.LogDescription =
      this.parseLog(log);

    const tradingAddr = revealEvt.args.trading;
    const committerAddr = revealEvt.args.revealer;
    const revealedOutcome = revealEvt.args.outcome;

    if (!this.#activeMarkets[tradingAddr]) {
      this.#activeMarkets[tradingAddr] = { outcomes: [] };
    }
    this.#activeMarkets[tradingAddr].outcomes.push(revealedOutcome);

    if (!this.#activeMarkets[tradingAddr].reveals) {
      this.#activeMarkets[tradingAddr].reveals = {};
    }
    this.#activeMarkets[tradingAddr].reveals![committerAddr] = revealedOutcome;

    this.#ifDeclare(tradingAddr);
  };

  #ifDeclare = async (tradingAddr: string) => {
    if (this.#activeMarkets[tradingAddr].declared) return;

    const s = await this.#marketStatus(tradingAddr);

    if (s?.state === InfraMarketState.Declarable) {
      this.#declare(tradingAddr);
    }

    await this.#ifSweep(tradingAddr);
  };

  #declare = (tradingAddr: string) => {
    const outcomes = this.#activeMarkets[tradingAddr].outcomes;
    this.txQueue.push(
      this.infraMarket.declare,
      tradingAddr,
      outcomes,
      this.txQueue.actor.address
    );
    this.#activeMarkets[tradingAddr].declared = true;
  };

  #close = (tradingAddr: string) =>
    this.txQueue.push(
      this.infraMarket.close,
      tradingAddr,
      this.txQueue.actor.address
    );

  #sweep = async (tradingAddr: string) => {
    const declaredWinner = await this.infraMarket.winner(tradingAddr);

    const reveals = this.#activeMarkets[tradingAddr].reveals || {};
    const victims = Object.keys(reveals).filter(
      (committerAddr) => reveals[committerAddr] !== declaredWinner
    );

    //TODO: get current market epoch using public getter or direct slot access
    // const epochNo = 0;

    // const victimsAddresses = victims.map(
    //   (committerAddr) => reveals[committerAddr]
    // );
    // this.txQueue.push(
    //   this.batchSweeper.sweepBatch,
    //   this.infraMarket.target,
    //   tradingAddr,
    //   epochNo,
    //   victimsAddresses,
    //   this.txQueue.actor.address
    // );
  };

  #escape = (tradingAddr: string) => {
    this.txQueue.push(this.infraMarket.escape, tradingAddr);
  };

  #scheduleClose = async (tradingAddr: string) => {
    const s = await this.#marketStatus(tradingAddr);

    if (s?.state === InfraMarketState.Whinging) {
      clearTimeout(this.#activeMarkets[tradingAddr]?.closeTimer);

      this.#activeMarkets[tradingAddr].closeTimer = setTimeout(() => {
        this.#close(tradingAddr);
      }, s?.remaining * 1000);
    }
  };

  #ifSweep = async (tradingAddr: string) => {
    const s = await this.#marketStatus(tradingAddr);
    if (s?.state === InfraMarketState.Sweeping) {
      await this.#sweep(tradingAddr);
    }
  };

  readonly #eventLUT: EventLUT = [
    [this.infraMarket.filters.MarketCreated2(), this.#onCreate],
    [this.infraMarket.filters.CallMade(), this.#onCall],
    [this.infraMarket.filters.InfraMarketClosed(), this.#onRemove],
    [this.infraMarket.filters.CampaignEscaped(), this.#onRemove],
    [this.infraMarket.filters.CommitmentRevealed(), this.#onReveal],
  ];
}
