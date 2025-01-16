import { StateMutability } from "./contracts/common";

import { TypedContractMethod } from "./contracts/common";

export type Writable = Exclude<StateMutability, "view">;

export type Pushable<
  F extends TypedContractMethod<A, R, Writable> = TypedContractMethod<
    any[],
    any,
    Writable
  >,
  A extends unknown[] = Parameters<F>,
  R = ReturnType<F>,
> = {
  func: F;
  args: A;
};
