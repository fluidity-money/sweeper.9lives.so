import { ethers } from "ethers";
import { InfraMarket } from "./types/contracts";

export const onInfraMarketActivity = (
  infraMarket: InfraMarket,
  wssProvider: ethers.WebSocketProvider
) => {
  wssProvider.on({ address: infraMarket.target }, (log) => {
    console.log(log);
  });
};
