import { Log } from "ethers";
import { TypedDeferredTopicFilter } from "./contracts/common";

export type ActiveMarkets = {
  [key: string]: { outcomes: string[] };
};

export type EventLUT = [TypedDeferredTopicFilter<any>, (log: Log) => void][];

export type ActiveLUT = { [key: string]: (log: Log) => void };

export enum InfraMarketState {
  Callable,
  Closable,
  Whinging,
  Predicting,
  Revealing,
  Declarable,
  Sweeping,
  Closed,
}
