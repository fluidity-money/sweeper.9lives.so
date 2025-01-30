import { ethers } from "ethers";
import { MockInfraMarket } from "../types/contracts/MockInfraMarket";
import { AsyncNonceWallet, sleep } from "../service/utils";
import {
  TypedDeferredTopicFilter,
  TypedContractEvent,
  TypedContractMethod,
} from "../types/contracts/common";
import { InfraMarketState } from "../types/market";

export const ONE_DAY = 24 * 60 * 60;
export const TWO_DAYS = 2 * ONE_DAY;
export const FOUR_DAYS = 4 * ONE_DAY;

export const ANVIL_RPC_URL = "http://localhost:8545";
export const ANVIL_WSS_URL = "ws://localhost:8545";
export const MNEMOIC =
  "test test test test test test test test test test test junk";
export const PHRASE = ethers.Mnemonic.fromPhrase(MNEMOIC);
export let PHRASES = new Array(10)
  .fill(0)
  .map((_, i) =>
    ethers.HDNodeWallet.fromMnemonic(PHRASE, `m/44'/60'/0'/0/${i}`)
  );

export const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);
export const asyncActor = new AsyncNonceWallet(PHRASES[0].privateKey, provider);

export const USERS = PHRASES.map(
  (phrase) => new AsyncNonceWallet(phrase.privateKey, provider)
);

export const now = (provider: ethers.Provider) =>
  provider.getBlock("pending").then((block) => block!.timestamp);

export const advanceBlockTimestamp = async (
  provider: ethers.JsonRpcProvider,
  seconds: number
) => {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
};

export const waitStatusOrTimeout = async (
  market: MockInfraMarket,
  tradingAddr: string,
  status?: InfraMarketState //undefined means escaped
) => {
  // We can't rely on system timers in testing environment
  let timePassed = 0;
  while (true) {
    await sleep(200);
    // Roughly
    timePassed += 200;

    if (timePassed > 5000) {
      return false;
    }

    if (!status) {
      const escaped = await market.campaign_has_escaped(tradingAddr);
      if (escaped) {
        return true;
      }
      continue;
    }

    const state = await market.status(tradingAddr);
    if (Number(state[0]) === status) {
      return true;
    }
  }
};

export const waitEmitOrTimeout = async (
  market: MockInfraMarket,
  wssProvider: ethers.WebSocketProvider,
  filter: TypedDeferredTopicFilter<TypedContractEvent<any, any, any>>,
  timeout: number = 3000
) => {
  let timePassed = 0;
  let emitted = false;
  market.connect(wssProvider).on(filter, () => {
    emitted = true;
  });

  while (!emitted) {
    await sleep(200);
    timePassed += 200;

    if (timePassed > timeout) {
      return false;
    }
  }

  return true;
};

export const waitCondition = async <A extends any[], R>(
  getter: TypedContractMethod<A, R, "view">,
  condition: (value: R) => boolean,
  ...args: A
) => {
  let timePassed = 0;
  while (true) {
    await sleep(200);
    timePassed += 200;

    if (timePassed > 3000) {
      return false;
    }

    const value = await getter(...((args as any) ?? []));
    if (condition(value)) {
      return true;
    }
  }
};

export const setTimestamp = async (
  provider: ethers.JsonRpcProvider,
  timestamp: number
) => {
  await provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await provider.send("evm_mine", []);
};

export const callMarket = async (
  mockInfraMarket: MockInfraMarket,
  tradingAddr: string,
  signer: ethers.Wallet
) => {
  const winner = ethers.hexlify(ethers.randomBytes(8));
  const tx = await mockInfraMarket.call(tradingAddr, winner, signer.address);
  await tx.wait();
  return winner;
};

export const whingeMarket = async (
  mockInfraMarket: MockInfraMarket,
  tradingAddr: string,
  signer: ethers.Wallet
) => {
  const preferredWinner = ethers.hexlify(ethers.randomBytes(8));
  const tx = await mockInfraMarket.whinge(
    tradingAddr,
    preferredWinner,
    signer.address
  );
  await tx.wait();
  return preferredWinner;
};

export const createCommitment = (
  signerAddress: string,
  outcome: string,
  seed: string
) => {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["address", "bytes8", "uint256"],
      [signerAddress, outcome, seed]
    )
  );
};
