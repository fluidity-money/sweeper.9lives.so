import { ContractTransaction, ethers } from "ethers";
import { Config } from "../types/config";
import { Pushable, Writable } from "../types/tx-queue";
import { AsyncNonceWallet, sleep, waitBlock } from "./utils";
import { TypedContractMethod } from "../types/contracts/common";
import { Logger } from "./logger";

export class TxQueue extends Logger {
  private queue: Pushable[] = [];
  public actor: AsyncNonceWallet;

  constructor(
    private config: Config,
    asyncWallet: AsyncNonceWallet
  ) {
    super();
    this.actor = asyncWallet;
    this.#start();
  }

  #start = () => {
    (async function sendLoop(thisService: TxQueue) {
      const intent = thisService.queue.shift();
      if (!intent) {
        setImmediate(() => sendLoop(thisService));
        return;
      }

      // TODO: add retry logic
      await thisService.#send(intent);

      setImmediate(() => sendLoop(thisService));
    })(this);
  };

  push = <A extends any[]>(
    func: TypedContractMethod<A, any, Writable>,
    ...args: Parameters<typeof func>
  ) => {
    this.queue.push({ func: func as Pushable["func"], args });
  };

  #estimate = async (txBody: ContractTransaction) => {
    const fee = await this.actor.provider!.getFeeData();
    const extraFee: any = {};

    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const extraTip =
        fee.maxPriorityFeePerGas +
        (fee.maxPriorityFeePerGas * this.config.GAS_RATIO) / 100n;

      extraFee.maxFeePerGas = fee.maxFeePerGas + extraTip;
      extraFee.maxPriorityFeePerGas = extraTip;
    } else if (fee.gasPrice) {
      const extraTip =
        fee.gasPrice + (fee.gasPrice * this.config.GAS_RATIO) / 100n;

      extraFee.gasPrice = extraTip;
    }

    return { ...txBody, ...extraFee };
  };

  #send = async (intent: Pushable) => {
    const buildResp = intent.func.populateTransaction(...intent.args);

    const txBody = await buildResp.catch(this.error);
    if (!txBody) {
      this.error(`Failed to build transaction ${intent.func.name}`);
      await sleep(1000);
      return;
    }

    const tipReq = this.#estimate(txBody);

    const tipped = await tipReq.catch(this.error);
    if (!tipped) {
      this.error(`Failed to estimate transaction ${intent.func.name}`);
      await sleep(1000);
      return;
    }

    const txReq = this.actor.sendTransaction(tipped);

    const txResp = await txReq.catch(this.error);
    if (!txResp) {
      this.error(`Failed to send transaction ${intent.func.name}`);
      await sleep(1000);
      return;
    }

    const waitReq = await txReq
      .then(waitBlock(this.config.CONFIRMATIONS))
      .catch(this.error);

    if (!waitReq) {
      this.error(`Failed to wait for transaction ${intent.func.name}`);
      await sleep(1000);
      return;
    }
  };

  flush = () => (this.queue = []);
}
