// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeRevertVault} from "../contracts/SafeRevertVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Fuzz tests for random amounts, delays and timestamps.
contract FuzzTest is Test {
    SafeRevertVault vault;
    MockERC20 token;

    address sender = address(0xA11CE);
    address recipient = address(0xB0B);
    address other = address(0xBEEF);

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        deal(sender, 10_000 ether);
        token.mint(sender, 1e40);
    }

    function testFuzz_createEth_validRanges(uint256 amount, uint256 delay, uint256 expiryOffset) public {
        amount = bound(amount, 1, 1_000 ether);
        delay = bound(delay, 1 minutes, 24 hours);
        expiryOffset = bound(expiryOffset, 1, 7 days);
        deal(sender, 10_000 ether);
        uint256 expiry = block.timestamp + delay + expiryOffset;
        uint256 unlock = block.timestamp + delay;

        vm.prank(sender);
        uint256 id = vault.createTransfer{value: amount}(recipient, address(0), amount, delay, expiry, bytes32(0));

        SafeRevertVault.Transfer memory t = vault.getTransfer(id);
        assertEq(t.amount, amount);
        assertEq(t.unlockTime, uint64(unlock));
        assertEq(t.expiry, uint64(expiry));
        assertEq(uint8(t.state), uint8(SafeRevertVault.State.Pending));
    }

    function testFuzz_createRevertsDelayOutOfRange(uint256 delay, uint256 amount) public {
        amount = bound(amount, 1, 100 ether);
        // pick a delay guaranteed outside [1 minutes, 24 hours]
        // (values generated in range get stomped to a definitely-invalid value)
        uint256 d = (delay % 2 == 0) ? bound(delay, 0, 59) : bound(delay, 24 hours + 1, 30 days);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidDelay(uint256)", d));
        vault.createTransfer{value: amount}(recipient, address(0), amount, d, block.timestamp + d + 1 days, bytes32(0));
    }

    function testFuzz_createRevertsExpiryNotAfterUnlock(uint256 expiryDelta, uint256 delay) public {
        delay = bound(delay, 1 minutes, 24 hours);
        // expiry in (now+delay-? , now+delay] region, i.e. expiry <= unlock
        uint256 unlock = block.timestamp + delay;
        uint256 expiry = unlock - bound(expiryDelta, 0, delay); // <= unlock
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidExpiry(uint256,uint256)", expiry, unlock));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, delay, expiry, bytes32(0));
    }

    function testFuzz_cancelReturnsExactAmount(uint256 amount, uint256 warpDelta) public {
        amount = bound(amount, 1, 500 ether);
        warpDelta = bound(warpDelta, 0, 59); // stay before unlock (min delay 60)
        deal(sender, 10_000 ether);
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: amount}(recipient, address(0), amount, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + warpDelta);
        uint256 before = sender.balance;
        vm.prank(sender);
        vault.cancel(id);
        assertEq(sender.balance, before + amount);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
    }

    function testFuzz_claimOnlyInWindow(uint256 warpDelta) public {
        warpDelta = bound(warpDelta, 0, 3 days);
        deal(sender, 10_000 ether);
        uint256 amount = 1 ether;
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: amount}(recipient, address(0), amount, 1 hours, block.timestamp + 2 days, bytes32(0));
        uint256 start = block.timestamp;
        vm.warp(start + warpDelta);
        bool inWindow = (warpDelta >= 1 hours && warpDelta < 2 days);
        if (inWindow) {
            uint256 before = recipient.balance;
            vm.prank(recipient);
            vault.claim(id, "");
            assertEq(recipient.balance, before + amount);
        } else {
            vm.prank(recipient);
            try vault.claim(id, "") {
                fail();
            } catch {
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
            }
        }
    }

    function testFuzz_refundOnlyAfterExpiry(uint256 warpDelta) public {
        warpDelta = bound(warpDelta, 0, 3 days);
        deal(sender, 10_000 ether);
        uint256 amount = 1 ether;
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: amount}(recipient, address(0), amount, 1 hours, block.timestamp + 2 days, bytes32(0));
        uint256 start = block.timestamp;
        vm.warp(start + warpDelta);
        if (warpDelta >= 2 days) {
            uint256 before = sender.balance;
            vm.prank(sender);
            vault.refund(id);
            assertEq(sender.balance, before + amount);
        } else {
            vm.prank(sender);
            try vault.refund(id) {
                fail();
            } catch {
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
            }
        }
    }

    function testFuzz_randomTimestamp_cancelThenClaimIsImpossible(uint256 warpDelta) public {
        warpDelta = bound(warpDelta, 0, 3 days);
        deal(sender, 10_000 ether);
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 1 days, bytes32(0));
        vm.prank(sender);
        vault.cancel(id);
        vm.warp(block.timestamp + warpDelta);
        vm.prank(recipient);
        try vault.claim(id, "") {
            fail();
        } catch {
            assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
        }
    }

    function testFuzz_erc20_createAndClaimEchoAmount(uint256 amount) public {
        amount = bound(amount, 1, 1_000 ether);
        vm.prank(sender);
        token.approve(address(vault), amount);
        vm.prank(sender);
        uint256 id = vault.createTransfer(recipient, address(token), amount, 1 hours, block.timestamp + 2 days, bytes32(0));
        assertEq(vault.getTransfer(id).amount, amount);
        vm.warp(block.timestamp + 1 hours);
        uint256 before = token.balanceOf(recipient);
        vm.prank(recipient);
        vault.claim(id, "");
        assertEq(token.balanceOf(recipient), before + amount);
    }

    function testFuzz_onlySenderCanCancelAndRefund(uint256 actorSeed) public {
        deal(sender, 10_000 ether);
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
        address actor = address(uint160(actorSeed % 10_000) + 0x10000);
        if (actor == sender) actor = other;
        // before unlock
        vm.prank(actor);
        try vault.cancel(id) {
            fail();
        } catch {}
        // after expiry
        vm.warp(block.timestamp + 2 days);
        vm.prank(actor);
        try vault.refund(id) {
            fail();
        } catch {}
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
    }

    function testFuzz_wrongSecretNeverSucceeds(uint256 actorSeed) public {
        deal(sender, 10_000 ether);
        bytes32 hash = keccak256(abi.encodePacked("correct-secret"));
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, hash);
        vm.warp(block.timestamp + 1 hours);
        // every secret except the preimage must revert. We only try wrong ones:
        string memory wrong = string.concat("wrong-", vm.toString(actorSeed));
        if (keccak256(abi.encodePacked(wrong)) == hash) wrong = "wrong-2";
        vm.prank(recipient);
        vm.expectRevert(SafeRevertVault.InvalidSecret.selector);
        vault.claim(id, wrong);
    }
}
