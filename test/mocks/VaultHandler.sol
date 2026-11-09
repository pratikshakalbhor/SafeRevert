// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeRevertVault} from "../../contracts/SafeRevertVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Handler for invariant tests. All actions use fixed sender/recipient/attacker
/// roles and bounded random parameters; ghosts track pending sums, claim times and
/// terminal states so invariant functions can cross-check the vault against them.
contract VaultHandler is Test {
    SafeRevertVault public vault;
    MockERC20 public token;

    address public sender = address(0xA11CE);
    address public recipient = address(0xB0B);
    address public attacker = address(0xBAD);

    bytes32 public secretHash = keccak256(abi.encodePacked("s3cret"));

    uint256 public sumEthPending;
    uint256 public sumTokenPending;

    mapping(uint256 => uint256) public claimTimes;
    mapping(uint256 => uint8) public finalState;
    mapping(uint256 => bool) public hasFinal;

    constructor(SafeRevertVault vault_, MockERC20 token_) {
        vault = vault_;
        token = token_;
        deal(sender, 100_000 ether);
        deal(recipient, 1 ether);
        deal(attacker, 1 ether);
        token.mint(sender, type(uint160).max);
    }

    function _syncFinals() internal {
        uint256 n = vault.nextId();
        for (uint256 i = 0; i < n; i++) {
            SafeRevertVault.Transfer memory t = vault.getTransfer(i);
            uint8 s = uint8(t.state);
            if (s != uint8(SafeRevertVault.State.Pending) && !hasFinal[i]) {
                hasFinal[i] = true;
                finalState[i] = s;
            }
        }
    }

    function _boundId(uint256 rawId) internal view returns (uint256) {
        uint256 n = vault.nextId();
        if (n == 0) return 0;
        return rawId % n;
    }

    function createEth(uint256 amountRaw, uint256 delayRaw, uint256 extraRaw) external {
        uint256 amount = bound(amountRaw, 1, 10 ether);
        uint256 delay = bound(delayRaw, 1 minutes, 24 hours);
        uint256 extra = bound(extraRaw, 1, 2 days);
        uint256 expiry = block.timestamp + delay + extra;
        deal(sender, sender.balance + 100 ether);
        vm.prank(sender);
        try vault.createTransfer{value: amount}(recipient, address(0), amount, delay, expiry, secretHash) returns (uint256 id) {
            sumEthPending += amount;
            // sanity: redo accounting check against the stored struct
            assertEq(vault.getTransfer(id).amount, amount);
            assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
        } catch {
            // validation revert -> nothing locked
        }
        _syncFinals();
    }

    function createToken(uint256 amountRaw, uint256 delayRaw, uint256 extraRaw) external {
        uint256 amount = bound(amountRaw, 1, 10_000 ether);
        uint256 delay = bound(delayRaw, 1 minutes, 24 hours);
        uint256 extra = bound(extraRaw, 1, 2 days);
        uint256 expiry = block.timestamp + delay + extra;
        token.mint(sender, amount);
        vm.startPrank(sender);
        token.approve(address(vault), amount);
        vm.stopPrank();
        vm.prank(sender);
        try vault.createTransfer(recipient, address(token), amount, delay, expiry, secretHash) {
            sumTokenPending += amount;
        } catch {}
        _syncFinals();
    }

    function cancel(uint256 rawId) external {
        if (vault.nextId() == 0) return;
        uint256 id = _boundId(rawId);
        // skip if already terminal (vault will revert NotPending anyway, but snapshot amounts first)
        SafeRevertVault.Transfer memory t = vault.getTransfer(id);
        if (t.state != SafeRevertVault.State.Pending) return;
        uint256 senderEthBefore = sender.balance;
        uint256 senderTokenBefore = token.balanceOf(sender);
        vm.prank(sender);
        try vault.cancel(id) {
            // Rule: after cancel, the sender receives exactly the deposited amount.
            if (t.token == address(0)) {
                assertEq(sender.balance, senderEthBefore + t.amount);
                sumEthPending -= t.amount;
            } else {
                assertEq(token.balanceOf(sender), senderTokenBefore + t.amount);
                sumTokenPending -= t.amount;
            }
            assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
        } catch {}
        _syncFinals();
    }

    function claim(uint256 rawId) external {
        if (vault.nextId() == 0) return;
        uint256 id = _boundId(rawId);
        SafeRevertVault.Transfer memory t = vault.getTransfer(id);
        if (t.state != SafeRevertVault.State.Pending) return;
        uint256 recipEthBefore = recipient.balance;
        uint256 recipTokenBefore = token.balanceOf(recipient);
        uint256 attEthBefore = attacker.balance;
        uint256 attTokenBefore = token.balanceOf(attacker);
        vm.prank(recipient);
        try vault.claim(id, "s3cret") {
            uint256 at = block.timestamp;
            claimTimes[id] = at;
            // Rule: never claimed before unlockTime.
            assertGe(at, uint256(t.unlockTime));
            // Rule: only the stored recipient ever receives funds on claim.
            if (t.token == address(0)) {
                assertEq(recipient.balance, recipEthBefore + t.amount);
                sumEthPending -= t.amount;
            } else {
                assertEq(token.balanceOf(recipient), recipTokenBefore + t.amount);
                sumTokenPending -= t.amount;
            }
            assertEq(attacker.balance, attEthBefore);
            assertEq(token.balanceOf(attacker), attTokenBefore);
            assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
        } catch {}
        _syncFinals();
    }

    function refund(uint256 rawId) external {
        if (vault.nextId() == 0) return;
        uint256 id = _boundId(rawId);
        SafeRevertVault.Transfer memory t = vault.getTransfer(id);
        if (t.state != SafeRevertVault.State.Pending) return;
        uint256 senderEthBefore = sender.balance;
        uint256 senderTokenBefore = token.balanceOf(sender);
        vm.prank(sender);
        try vault.refund(id) {
            if (t.token == address(0)) {
                assertEq(sender.balance, senderEthBefore + t.amount);
                sumEthPending -= t.amount;
            } else {
                assertEq(token.balanceOf(sender), senderTokenBefore + t.amount);
                sumTokenPending -= t.amount;
            }
            assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Refunded));
        } catch {}
        _syncFinals();
    }

    function warpTime(uint256 deltaRaw) external {
        uint256 delta = bound(deltaRaw, 1, 3 days);
        vm.warp(block.timestamp + delta);
        _syncFinals();
    }
}
