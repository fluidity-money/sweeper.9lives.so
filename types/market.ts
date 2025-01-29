import { Log } from "ethers";
import {
  TypedDeferredTopicFilter,
  TypedContractEvent,
} from "./contracts/common";

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

export type ActiveMarkets = {
  [tradingAddr: string]: {
    escapeTimer?: NodeJS.Timeout;
    closeTimer?: NodeJS.Timeout;
    declareTimer?: NodeJS.Timeout;
  };
};

export type ActiveLUT = {
  [topic: string]: (log: Log) => void;
};

export type EventLUT = [
  TypedDeferredTopicFilter<TypedContractEvent>,
  (log: Log) => void,
][];
