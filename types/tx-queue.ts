import { TypedContractMethod } from "./contracts/common";

export type Writable = "nonpayable" | "payable";

export type Pushable = {
  func: TypedContractMethod<any[], any, Writable>;
  args: any[];
};
