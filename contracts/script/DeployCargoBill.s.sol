// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {CargoBill} from "../CargoBill.sol";

contract DeployCargoBill is Script {
    function run() external returns (CargoBill bill) {
        address usdc = vm.envAddress("USDC");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address arbiter = vm.envAddress("ARBITER");

        vm.startBroadcast();
        bill = new CargoBill(usdc, feeRecipient, arbiter);
        vm.stopBroadcast();

        console.log("CargoBill deployed at:", address(bill));
    }
}
