// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {SafeRevertVault} from "../contracts/SafeRevertVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Gas benchmarks, split by asset so the report table can show ETH vs ERC-20.
/// @dev Run with: forge test --match-contract GasBenchmark -vvv
/// Numbers include cheatcode overhead (prank/deal) but are directly comparable across paths.
contract GasBenchmark is Test {
    SafeRevertVault vault;
    MockERC20 token;

    address sender = address(0xA11CE);
    address recipient = address(0xB0B);

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        deal(sender, 1000 ether);
        token.mint(sender, 1_000_000 ether);
    }

    function _createEth(uint256 amount) internal returns (uint256 id) {
        vm.prank(sender);
        id = vault.createTransfer{value: amount}(recipient, address(0), amount, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function _createErc20(uint256 amount) internal returns (uint256 id) {
        vm.startPrank(sender);
        token.approve(address(vault), amount);
        vm.stopPrank();
        vm.prank(sender);
        id = vault.createTransfer(recipient, address(token), amount, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function test_gasCreateEth() public {
        uint256 g0 = gasleft();
        _createEth(1 ether);
        uint256 g = g0 - gasleft();
        console.log("createTransfer (ETH):");
        console.log(g);
    }

    function test_gasCreateErc20() public {
        uint256 g0 = gasleft();
        _createErc20(100 ether);
        uint256 g = g0 - gasleft();
        console.log("createTransfer (ERC-20):");
        console.log(g);
    }

    function test_gasCancelEth() public {
        uint256 id = _createEth(1 ether);
        vm.prank(sender);
        uint256 g0 = gasleft();
        vault.cancel(id);
        uint256 g = g0 - gasleft();
        console.log("cancel (ETH):");
        console.log(g);
    }

    function test_gasCancelErc20() public {
        uint256 id = _createErc20(100 ether);
        vm.prank(sender);
        uint256 g0 = gasleft();
        vault.cancel(id);
        uint256 g = g0 - gasleft();
        console.log("cancel (ERC-20):");
        console.log(g);
    }

    function test_gasClaimEth() public {
        uint256 id = _createEth(1 ether);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        uint256 g0 = gasleft();
        vault.claim(id, "");
        uint256 g = g0 - gasleft();
        console.log("claim (ETH):");
        console.log(g);
    }

    function test_gasClaimErc20() public {
        uint256 id = _createErc20(100 ether);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        uint256 g0 = gasleft();
        vault.claim(id, "");
        uint256 g = g0 - gasleft();
        console.log("claim (ERC-20):");
        console.log(g);
    }

    function test_gasRefundEth() public {
        uint256 id = _createEth(1 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        uint256 g0 = gasleft();
        vault.refund(id);
        uint256 g = g0 - gasleft();
        console.log("refund (ETH):");
        console.log(g);
    }

    function test_gasRefundErc20() public {
        uint256 id = _createErc20(100 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        uint256 g0 = gasleft();
        vault.refund(id);
        uint256 g = g0 - gasleft();
        console.log("refund (ERC-20):");
        console.log(g);
    }
}
