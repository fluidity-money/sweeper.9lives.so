import { ethers, Log } from "ethers";
import { InfraMarket } from "./types/contracts";
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
} from "./types/contracts/InfraMarket";
import { TxQueue } from "./tx-queue";

export class InfraMarketHandler {
  #activeMarkets: ActiveMarkets = {};
  #activeEventLUT: ActiveLUT = {};

  constructor(
    private infraMarket: InfraMarket,
    private wssProvider: ethers.WebSocketProvider,
    private txQueue: TxQueue
  ) {}

  public init = async () => {
    this.#initEventLUT();
    await this.#filterMarkets();
  };

  #filterMarkets = async () => {
    const markets = await this.infraMarket.queryFilter(
      this.infraMarket.filters.MarketCreated2()
    );

    for (const market of markets) {
      const { state, remaining } = await this.infraMarket
        .status(market.args.tradingAddr)
        .then((s) => ({
          state: Number(s.currentState) as InfraMarketState,
          remaining: Number(s.secsRemaining),
        }));

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

    this.#activeMarkets[revealEvt.args.trading].outcomes.push(
      revealEvt.args.outcome
    );

    this.#ifDeclare(revealEvt.args.trading);
  };

  #ifDeclare = async (tradingAddr: string) => {
    if (this.#activeMarkets[tradingAddr].declared) return;

    const { currentState } = await this.infraMarket.status(tradingAddr);
    if (Number(currentState) === InfraMarketState.Declarable) {
      this.#declare(tradingAddr);
    }
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

  #sweep = (tradingAddr: string) => {
    // this.infraMarket.sweep();
  };

  #escape = (tradingAddr: string) => {
    this.txQueue.push(this.infraMarket.escape, tradingAddr);
  };

  #scheduleClose = async (tradingAddr: string) => {
    const { currentState, secsRemaining } =
      await this.infraMarket.status(tradingAddr);

    if (Number(currentState) === InfraMarketState.Whinging) {
      clearTimeout(this.#activeMarkets[tradingAddr]?.closeTimer);

      this.#activeMarkets[tradingAddr].closeTimer = setTimeout(
        () => {
          this.#close(tradingAddr);
        },
        Number(secsRemaining) * 1000
      );
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
