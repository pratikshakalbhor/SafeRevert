// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SafeRevertVault} from "../contracts/SafeRevertVault.sol";

/// @notice Deploys SafeRevertVault.
/// @dev Usage (local / sepolia):
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PK --broadcast
///   forge script script/Deploy.s.sol --rpc-url sepolia --private-key $PK --broadcast --verify
contract Deploy is Script {
    function run() public returns (address vault) {
        vm.startBroadcast();
        SafeRevertVault v = new SafeRevertVault();
        vm.stopBroadcast();

        console.log("SafeRevertVault deployed to:", address(v));
        return address(v);
    }
}
