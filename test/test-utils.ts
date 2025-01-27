import { ethers } from "ethers";
import { MockInfraMarket } from "../types/contracts/MockInfraMarket";

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
  signer: ethers.Wallet,
  outcome: string,
  seed: string
) => {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["address", "bytes8", "uint256"],
      [signer.address, outcome, seed]
    )
  );
};

export const predictAndReveal = async (
  mockInfraMarket: MockInfraMarket,
  tradingAddr: string,
  signer: ethers.Wallet,
  provider: ethers.JsonRpcProvider
) => {
  const outcome = ethers.hexlify(ethers.randomBytes(8));
  const seed = ethers.hexlify(ethers.randomBytes(32));

  const commitment = createCommitment(signer, outcome, seed);
  const tx1 = await mockInfraMarket.predict(tradingAddr, commitment);
  await tx1.wait();

  await provider.send("evm_increaseTime", [2 * 24 * 60 * 60]);
  await provider.send("evm_mine", []);

  const tx2 = await mockInfraMarket.reveal(
    tradingAddr,
    signer.address,
    outcome,
    seed
  );
  await tx2.wait();

  return outcome;
};
