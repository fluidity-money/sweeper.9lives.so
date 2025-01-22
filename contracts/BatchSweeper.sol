// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IInfraMarket} from "./IInfraMarket.sol";

contract BatchSweeper {
    /**
     * Calls sweep method on the infra-market for each
     * address from the victims array.
     *
     * @param infraMarket       InfraMarket contract address
     * @param tradingAddr       Specific campaign/trading address
     * @param epochNo           Epoch number from your contract
     * @param victims           List of "guilty" addresses that need to be "swept"
     * @param feeRecipient      Who receives possible fees
     */
    function sweepBatch(
        address infraMarket,
        address tradingAddr,
        uint256 epochNo,
        address[] calldata victims,
        address feeRecipient
    ) external {
        for (uint256 i = 0; i < victims.length; i++) {
            IInfraMarket(infraMarket).sweep(
                tradingAddr,
                epochNo,
                victims[i],
                feeRecipient
            );
        }
    }
}
