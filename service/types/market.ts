import { Log } from "ethers";
import { TypedDeferredTopicFilter } from "./contracts/common";

export type ActiveMarkets = {
  [key: string]: {
    outcomes: string[];
    escapeTimer?: NodeJS.Timeout;
    closeTimer?: NodeJS.Timeout;
    reveals?: { [key: string]: string };
    declared?: boolean;
  };
};

export type EventLUT = [TypedDeferredTopicFilter<any>, (log: Log) => void][];

export type ActiveLUT = { [key: string]: (log: Log) => void };

export enum InfraMarketState {
  Callable = 0,
  Closable,
  Whinging,
  Predicting,
  Revealing,
  Declarable,
  Sweeping,
  Closed,
}
