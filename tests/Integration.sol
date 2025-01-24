// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IInfraMarket} from "../contracts/IInfraMarket.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {console} from "forge-std/console.sol";
import {Test} from "forge-std/Test.sol";

contract Integration is Test {
    IInfraMarket infraMarket;

    function setUp() public {
        address factory1Impl = vm.envAddress("SUPERPOSITION_INFRA_MARKET_IMPL");

        infraMarket = IInfraMarket(
            address(
                new TransparentUpgradeableProxy(factory1Impl, address(this), "")
            )
        );

        console.logBytes(address(infraMarket).code);

        infraMarket.ctor(
            address(this),
            address(this),
            address(this),
            address(this),
            address(this)
        );
    }

    function test_infraMarket() public {}
}
