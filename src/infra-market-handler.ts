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
    // TODO: add queryFilter on markets
    this.#initEventLUT();
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
      //TODO: add escapability check
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
      return;
    }

    this.#activeMarkets[callEvt.args.tradingAddr].outcomes.push(
      callEvt.args.winner
    );
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
  };

  #close = (tradingAddr: string) =>
    this.txQueue.push(
      this.infraMarket.close,
      tradingAddr,
      this.txQueue.actor.address
    );

  #declare = (tradingAddr: string) => {
    // this.infraMarket.declare();
  };

  #sweep = (tradingAddr: string) => {
    // this.infraMarket.sweep();
  };

  readonly #eventLUT: EventLUT = [
    [this.infraMarket.filters.MarketCreated2(), this.#onCreate],
    [this.infraMarket.filters.CallMade(), this.#onCall],
    [this.infraMarket.filters.InfraMarketClosed(), this.#onRemove],
    [this.infraMarket.filters.CampaignEscaped(), this.#onRemove],
    [this.infraMarket.filters.CommitmentRevealed(), this.#onReveal],
  ];

  readonly #actionLUT = {
    [InfraMarketState.Closable]: this.#close,
    [InfraMarketState.Declarable]: this.#declare,
    [InfraMarketState.Sweeping]: this.#sweep,
  };
}
