// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {HaulwiseGreenLane} from "../HaulwiseGreenLane.sol";

contract DeployGreenLane is Script {
    function run() external returns (HaulwiseGreenLane gl) {
        address usdc = vm.envAddress("USDC");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address arbiter = vm.envAddress("ARBITER");
        address attestor = vm.envAddress("ATTESTOR");
        vm.startBroadcast();
        gl = new HaulwiseGreenLane(usdc, feeRecipient, arbiter, attestor);
        vm.stopBroadcast();
        console.log("HaulwiseGreenLane deployed at:", address(gl));
    }
}
