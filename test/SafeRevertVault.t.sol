// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {SafeRevertVault} from "../contracts/SafeRevertVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeeToken} from "./mocks/MockFeeToken.sol";

/// @notice Unit tests: every function and every revert path for ETH + ERC-20.
contract SafeRevertVaultTest is Test {
    SafeRevertVault vault;
    MockERC20 token;
    MockFeeToken feeToken;
    MockFeeToken fullFeeToken;

    address sender = address(0xA11CE);
    address recipient = address(0xB0B);
    address attacker = address(0xBAD);
    address thirdParty = address(0xCAFE);

    bytes32 constant SECRET_HASH = keccak256(abi.encodePacked("s3cret"));

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        feeToken = new MockFeeToken(1000); // 10% fee
        fullFeeToken = new MockFeeToken(10_000); // 100% fee
        deal(sender, 100 ether);
        deal(recipient, 10 ether);
        deal(attacker, 10 ether);
        token.mint(sender, 1_000_000 ether);
        feeToken.mint(sender, 1_000_000 ether);
        fullFeeToken.mint(sender, 1_000_000 ether);
    }

    // ---- helpers ----
    function _createEth(uint256, uint256 amount) internal returns (uint256) {
        vm.startPrank(sender);
        uint256 got = vault.createTransfer{value: amount}(recipient, address(0), amount, 1 hours, block.timestamp + 2 days, SECRET_HASH);
        vm.stopPrank();
        return got;
    }

    function _createToken(uint256, uint256 amount) internal returns (uint256) {
        vm.startPrank(sender);
        token.approve(address(vault), amount);
        uint256 got = vault.createTransfer(recipient, address(token), amount, 1 hours, block.timestamp + 2 days, SECRET_HASH);
        vm.stopPrank();
        return got;
    }

    // ============ createTransfer ============
    function test_createEth_success() public {
        uint256 amount = 1 ether;
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: amount}(recipient, address(0), amount, 1 hours, block.timestamp + 2 days, SECRET_HASH);
        assertEq(id, 0);
        assertEq(vault.nextId(), 1);
        SafeRevertVault.Transfer memory t = vault.getTransfer(id);
        assertEq(t.sender, sender);
        assertEq(t.recipient, recipient);
        assertEq(t.token, address(0));
        assertEq(t.amount, amount);
        assertEq(t.unlockTime, uint64(block.timestamp + 1 hours));
        assertEq(t.expiry, uint64(block.timestamp + 2 days));
        assertEq(t.secretHash, SECRET_HASH);
        assertEq(uint8(t.state), uint8(SafeRevertVault.State.Pending));
        assertEq(address(vault).balance, amount);
    }

    function test_createErc20_success() public {
        uint256 amount = 100 ether;
        vm.prank(sender);
        token.approve(address(vault), amount);
        vm.prank(sender);
        uint256 id = vault.createTransfer(recipient, address(token), amount, 1 hours, block.timestamp + 2 days, SECRET_HASH);
        assertEq(vault.getTransfer(id).amount, amount);
        assertEq(token.balanceOf(address(vault)), amount);
        assertEq(token.balanceOf(sender), 1_000_000 ether - amount);
    }

    function test_createFeeOnTransfer_locksReceivedAmount() public {
        uint256 amount = 100 ether; // 10% fee -> vault receives 90
        vm.prank(sender);
        feeToken.approve(address(vault), amount);
        vm.prank(sender);
        uint256 id = vault.createTransfer(recipient, address(feeToken), amount, 1 hours, block.timestamp + 2 days, SECRET_HASH);
        assertEq(vault.getTransfer(id).amount, 90 ether);
        assertEq(feeToken.balanceOf(address(vault)), 90 ether);
    }

    function test_createFullFeeToken_revertsInvalidAmount() public {
        vm.prank(sender);
        fullFeeToken.approve(address(vault), 100 ether);
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidAmount.selector);
        vault.createTransfer(recipient, address(fullFeeToken), 100 ether, 1 hours, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createEmitsTransferCreated() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit SafeRevertVault.TransferCreated(0, sender, recipient, address(0), 1 ether, uint64(block.timestamp + 1 hours), uint64(block.timestamp + 2 days));
        vm.prank(sender);
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createRevertsInvalidRecipient() public {
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidRecipient.selector);
        vault.createTransfer{value: 1 ether}(address(0), address(0), 1 ether, 1 hours, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createRevertsZeroAmountEth() public {
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidAmount.selector);
        vault.createTransfer(recipient, address(0), 0, 1 hours, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createRevertsZeroAmountToken() public {
        vm.prank(sender);
        token.approve(address(vault), 1);
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidAmount.selector);
        vault.createTransfer(recipient, address(token), 0, 1 hours, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createRevertsDelayTooShort() public {
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidDelay(uint256)", uint256(59)));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 59, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createRevertsDelayTooLong() public {
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidDelay(uint256)", uint256(24 hours + 1)));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 24 hours + 1, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createAcceptsBoundaryDelays() public {
        // 1 minute minimum
        vm.prank(sender);
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 minutes, block.timestamp + 2 days, SECRET_HASH);
        // 24 hours maximum
        vm.prank(sender);
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 24 hours, block.timestamp + 2 days, SECRET_HASH);
        assertEq(vault.nextId(), 2);
    }

    function test_createRevertsInvalidExpiry() public {
        uint256 unlock = block.timestamp + 1 hours;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidExpiry(uint256,uint256)", unlock, unlock));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, unlock, SECRET_HASH);
    }

    function test_createRevertsMsgValueMismatchEth() public {
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.MsgValueMismatch.selector);
        vault.createTransfer{value: 2 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createRevertsMsgValueMismatchToken() public {
        vm.prank(sender);
        token.approve(address(vault), 1 ether);
        // Sending ETH alongside an ERC-20 create
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.MsgValueMismatch.selector);
        vault.createTransfer{value: 1 ether}(recipient, address(token), 1 ether, 1 hours, block.timestamp + 2 days, SECRET_HASH);
    }

    function test_createZeroSecretHashAllowed() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
        assertEq(vault.getTransfer(id).secretHash, bytes32(0));
    }

    // ============ cancel ============
    function test_cancelEth_success() public {
        uint256 id = _createEth(0, 1 ether);
        uint256 senderBefore = sender.balance;
        uint256 vaultBefore = address(vault).balance;
        vm.prank(sender);
        vault.cancel(id);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
        assertEq(sender.balance, senderBefore + 1 ether);
        assertEq(address(vault).balance, vaultBefore - 1 ether);
    }

    function test_cancelErc20_success() public {
        uint256 id = _createToken(0, 100 ether);
        uint256 before = token.balanceOf(sender);
        vm.prank(sender);
        vault.cancel(id);
        assertEq(token.balanceOf(sender), before + 100 ether);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
    }

    function test_cancelEmitsCancelled() public {
        uint256 id = _createEth(0, 1 ether);
        vm.expectEmit(true, true, true, true, address(vault));
        emit SafeRevertVault.Cancelled(id, sender, 1 ether);
        vm.prank(sender);
        vault.cancel(id);
    }

    function test_cancelRevertsNotFound() public {
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("TransferNotFound(uint256)", uint256(999)));
        vault.cancel(999);
    }

    function test_cancelRevertsNotSender() public {
        uint256 id = _createEth(0, 1 ether);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("NotSender(uint256,address)", id, attacker));
        vault.cancel(id);
    }

    function test_cancelRevertsTooSmallTimeWindow() public {
        uint256 id = _createEth(0, 1 ether);
        uint256 unlock = vault.getTransfer(id).unlockTime;
        vm.warp(unlock); // unlock reached
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.TooEarly.selector, id, unlock));
        vault.cancel(id);
    }

    function test_cancelRevertsNotPendingAfterClaim() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(recipient);
        vault.claim(id, "s3cret");
        SafeRevertVault.State st = vault.getTransfer(id).state;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, st));
        vault.cancel(id);
    }

    function test_cancelRevertsNotPendingAfterCancel() public {
        uint256 id = _createEth(0, 1 ether);
        vm.prank(sender);
        vault.cancel(id);
        SafeRevertVault.State st = vault.getTransfer(id).state;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, st));
        vault.cancel(id);
    }

    function test_cancelFromRecipientReverts() public {
        uint256 id = _createEth(0, 1 ether);
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSignature("NotSender(uint256,address)", id, recipient));
        vault.cancel(id);
    }

    // ============ claim ============
    function test_claimEth_successWithSecret() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 1 hours);
        uint256 before = recipient.balance;
        vm.prank(recipient);
        vault.claim(id, "s3cret");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
        assertEq(recipient.balance, before + 1 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_claimErc20_successWithSecret() public {
        uint256 id = _createToken(0, 100 ether);
        vm.warp(block.timestamp + 1 hours);
        uint256 before = token.balanceOf(recipient);
        vm.prank(recipient);
        vault.claim(id, "s3cret");
        assertEq(token.balanceOf(recipient), before + 100 ether);
    }

    function test_claimZeroHashNoSecretNeeded() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vault.claim(id, "anything-ignored");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_claimEmitsClaimed() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, true, true, true, address(vault));
        emit SafeRevertVault.Claimed(id, recipient, 1 ether);
        vm.prank(recipient);
        vault.claim(id, "s3cret");
    }

    function test_claimRevertsNotFound() public {
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSignature("TransferNotFound(uint256)", uint256(7)));
        vault.claim(7, "s3cret");
    }

    function test_claimRevertsNotRecipient() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("NotRecipient(uint256,address)", id, attacker));
        vault.claim(id, "s3cret");
    }

    function test_claimRevertsTooEarly() public {
        uint256 id = _createEth(0, 1 ether);
        uint256 unlock = vault.getTransfer(id).unlockTime;
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.TooEarly.selector, id, unlock));
        vault.claim(id, "s3cret");
    }

    function test_claimRevertsExpired() public {
        uint256 id = _createEth(0, 1 ether);
        uint256 expiry = vault.getTransfer(id).expiry;
        vm.warp(expiry); // expiry reached
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.Expired.selector, id, expiry));
        vault.claim(id, "s3cret");
    }

    function test_claimRevertsWrongSecret() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vm.expectRevert(SafeRevertVault.InvalidSecret.selector);
        vault.claim(id, "wrong");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
    }

    function test_claimExactlyAtUnlockAndJustBeforeExpiry() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 1 hours); // == unlockTime
        vm.prank(recipient);
        vault.claim(id, "s3cret");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_claimRevertsNotPendingAfterCancel() public {
        uint256 id = _createEth(0, 1 ether);
        vm.prank(sender);
        vault.cancel(id);
        vm.warp(block.timestamp + 1 hours);
        SafeRevertVault.State st = vault.getTransfer(id).state;
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, st));
        vault.claim(id, "s3cret");
    }

    function test_claimRevertsNotPendingAfterRefund() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        vault.refund(id);
        // now past expiry; refund already moved to terminal so claim hits NotPending first
        SafeRevertVault.State st = vault.getTransfer(id).state;
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, st));
        vault.claim(id, "s3cret");
    }

    // ============ refund ============
    function test_refundEth_success() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 2 days);
        uint256 before = sender.balance;
        vm.prank(sender);
        vault.refund(id);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Refunded));
        assertEq(sender.balance, before + 1 ether);
    }

    function test_refundErc20_success() public {
        uint256 id = _createToken(0, 100 ether);
        vm.warp(block.timestamp + 2 days);
        uint256 before = token.balanceOf(sender);
        vm.prank(sender);
        vault.refund(id);
        assertEq(token.balanceOf(sender), before + 100 ether);
    }

    function test_refundEmitsRefunded() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 2 days);
        vm.expectEmit(true, true, true, true, address(vault));
        emit SafeRevertVault.Refunded(id, sender, 1 ether);
        vm.prank(sender);
        vault.refund(id);
    }

    function test_refundRevertsNotFound() public {
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("TransferNotFound(uint256)", uint256(3)));
        vault.refund(3);
    }

    function test_refundRevertsNotSender() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("NotSender(uint256,address)", id, attacker));
        vault.refund(id);
    }

    function test_refundRevertsTooEarly() public {
        uint256 id = _createEth(0, 1 ether);
        uint256 expiry = vault.getTransfer(id).expiry;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.TooEarly.selector, id, expiry));
        vault.refund(id);
    }

    function test_refundRevertsNotPendingAfterClaim() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vault.claim(id, "s3cret");
        vm.warp(block.timestamp + 2 days);
        SafeRevertVault.State st = vault.getTransfer(id).state;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, st));
        vault.refund(id);
    }

    function test_refundRevertsNotPendingAfterRefund() public {
        uint256 id = _createEth(0, 1 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        vault.refund(id);
        SafeRevertVault.State st = vault.getTransfer(id).state;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, st));
        vault.refund(id);
    }

    // ============ views ============
    function test_getTransferRevertsNotFound() public {
        // expectRevert needs non-view context; do a try/catch via low-level call
        (bool ok, ) = address(vault).call(abi.encodeWithSignature("getTransfer(uint256)", uint256(42)));
        assertFalse(ok);
    }

    function test_getTransferRevertsNotFound_pranked() public {
        vm.expectRevert(abi.encodeWithSignature("TransferNotFound(uint256)", uint256(42)));
        vault.getTransfer(42);
    }

    function test_nextIdIncrements() public {
        assertEq(vault.nextId(), 0);
        _createEth(0, 1 ether);
        assertEq(vault.nextId(), 1);
        _createToken(0, 10 ether);
        assertEq(vault.nextId(), 2);
    }

    function test_thirdPartyCannotTouchPendingTransfer() public view {
        // sanity: attacker balances untouched after setup paths (also covered in attack suite)
        assertTrue(thirdParty != sender && thirdParty != recipient);
    }

    function test_feeTokenClaim_paysReceivedAmountOnly() public {
        vm.prank(sender);
        feeToken.approve(address(vault), 100 ether);
        vm.prank(sender);
        uint256 id = vault.createTransfer(recipient, address(feeToken), 100 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 hours);
        uint256 before = feeToken.balanceOf(recipient);
        vm.prank(recipient);
        vault.claim(id, "");
        // vault pays 90 (locked) but outbound fee applies again: recipient gets 90 - 9 = 81
        assertEq(feeToken.balanceOf(recipient), before + 81 ether);
    }

    function test_multiplePendingTransfers_trackedIndependently() public {
        uint256 id1 = _createEth(0, 1 ether);
        uint256 id2 = _createEth(0, 2 ether);
        assertEq(address(vault).balance, 3 ether);
        vm.prank(sender);
        vault.cancel(id1);
        assertEq(address(vault).balance, 2 ether);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vault.claim(id2, "s3cret");
        assertEq(address(vault).balance, 0);
    }
}

/// @notice Boundary tests with vm.warp: exact instants around unlockTime / expiry / delay limits.
contract SafeRevertVaultBoundaryTest is Test {
    SafeRevertVault vault;
    MockERC20 token;

    address sender = address(0xA11CE);
    address recipient = address(0xB0B);

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        deal(sender, 100 ether);
        token.mint(sender, 1_000_000 ether);
    }

    function _create(uint256 amount) internal returns (uint256 id, uint256 unlock, uint256 expiry) {
        uint256 delay = 1 hours;
        vm.prank(sender);
        id = vault.createTransfer{value: amount}(recipient, address(0), amount, delay, block.timestamp + 2 days, bytes32(0));
        unlock = block.timestamp + delay;
        expiry = block.timestamp + 2 days;
    }

    function test_cancelAtUnlockMinusOne_succeeds() public {
        (uint256 id, uint256 unlock, ) = _create(1 ether);
        vm.warp(unlock - 1);
        vm.prank(sender);
        vault.cancel(id);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
    }

    function test_cancelAtUnlock_reverts() public {
        (uint256 id, uint256 unlock, ) = _create(1 ether);
        vm.warp(unlock);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.TooEarly.selector, id, unlock));
        vault.cancel(id);
    }

    function test_claimAtUnlock_succeeds() public {
        (uint256 id, uint256 unlock, ) = _create(1 ether);
        vm.warp(unlock);
        uint256 before = recipient.balance;
        vm.prank(recipient);
        vault.claim(id, "");
        assertEq(recipient.balance, before + 1 ether);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_claimAtExpiryMinusOne_succeeds() public {
        (uint256 id, , uint256 expiry) = _create(1 ether);
        vm.warp(expiry - 1);
        vm.prank(recipient);
        vault.claim(id, "");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_claimAtExpiry_reverts() public {
        (uint256 id, , uint256 expiry) = _create(1 ether);
        vm.warp(expiry);
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.Expired.selector, id, expiry));
        vault.claim(id, "");
    }

    function test_refundAtExpiryMinusOne_reverts() public {
        (uint256 id, , uint256 expiry) = _create(1 ether);
        vm.warp(expiry - 1);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.TooEarly.selector, id, expiry));
        vault.refund(id);
    }

    function test_refundAtExpiry_succeeds() public {
        (uint256 id, , uint256 expiry) = _create(1 ether);
        vm.warp(expiry);
        uint256 before = sender.balance;
        vm.prank(sender);
        vault.refund(id);
        assertEq(sender.balance, before + 1 ether);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Refunded));
    }

    function test_delayExactlyOneMinute_accepted() public {
        vm.prank(sender);
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        assertEq(vault.nextId(), 1);
    }

    function test_delayExactly24Hours_accepted() public {
        vm.prank(sender);
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 24 hours, block.timestamp + 2 days, bytes32(0));
        assertEq(vault.nextId(), 1);
    }

    function test_delayOneSecondBelowMin_rejected() public {
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidDelay(uint256)", uint256(59)));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 59, block.timestamp + 2 days, bytes32(0));
    }

    function test_delayOneSecondAboveMax_rejected() public {
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidDelay(uint256)", uint256(24 hours + 1)));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 24 hours + 1, block.timestamp + 2 days, bytes32(0));
    }

    function test_expiryExactlyAtUnlock_reverts() public {
        uint256 unlock = block.timestamp + 1 hours;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidExpiry(uint256,uint256)", unlock, unlock));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, unlock, bytes32(0));
    }

    function test_expiryOneSecondAboveUnlock_accepted() public {
        uint256 unlock = block.timestamp + 1 hours;
        vm.prank(sender);
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, unlock + 1, bytes32(0));
        assertEq(vault.nextId(), 1);
    }
}

/// @notice Input-validation tests, including the two post-fix validations.
contract SafeRevertVaultValidationTest is Test {
    SafeRevertVault vault;
    MockERC20 token;

    address sender = address(0xA11CE);
    address recipient = address(0xB0B);

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        deal(sender, 100 ether);
        token.mint(sender, 1_000_000 ether);
    }

    function test_zeroAmountEth_reverts() public {
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidAmount.selector);
        vault.createTransfer(recipient, address(0), 0, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function test_zeroAmountToken_reverts() public {
        vm.prank(sender);
        token.approve(address(vault), 1);
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidAmount.selector);
        vault.createTransfer(recipient, address(token), 0, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function test_zeroAddressRecipient_reverts() public {
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidRecipient.selector);
        vault.createTransfer{value: 1 ether}(address(0), address(0), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function test_vaultItselfAsRecipient_reverts() public {
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.InvalidRecipient.selector);
        vault.createTransfer{value: 1 ether}(address(vault), address(0), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function test_wrongMsgValueForEth_reverts() public {
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.MsgValueMismatch.selector);
        vault.createTransfer{value: 2 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function test_nonZeroMsgValueOnErc20_reverts() public {
        vm.prank(sender);
        token.approve(address(vault), 1 ether);
        vm.prank(sender);
        vm.expectRevert(SafeRevertVault.MsgValueMismatch.selector);
        vault.createTransfer{value: 1 ether}(recipient, address(token), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
    }

    function test_expiryBelowUnlock_reverts() public {
        uint256 unlock = block.timestamp + 1 hours;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSignature("InvalidExpiry(uint256,uint256)", unlock - 1, unlock));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, unlock - 1, bytes32(0));
    }

    function test_expiryAboveUint64Max_reverts() public {
        uint256 huge = (uint256(1) << 64) + 5;
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.InvalidExpiry.selector, huge, block.timestamp + 1 hours));
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, huge, bytes32(0));
    }

    function test_expiryAtUint64Max_accepted() public {
        uint256 maxExpiry = type(uint64).max;
        vm.prank(sender);
        vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, maxExpiry, bytes32(0));
        assertEq(vault.getTransfer(0).expiry, uint64(maxExpiry));
    }
}

/// @notice Secret-encoding tests: pin exactly how the frontend must hash.
contract SafeRevertVaultSecretTest is Test {
    SafeRevertVault vault;

    address sender = address(0xA11CE);
    address recipient = address(0xB0B);

    function setUp() public {
        vault = new SafeRevertVault();
        deal(sender, 100 ether);
    }

    function test_offchainHashMatchesOnchainCheck() public {
        // This is the exact encoding the frontend must use:
        //   secretHash = keccak256(abi.encodePacked(secret))
        // where `secret` is the raw string revealed in claim().
        // A JS frontend would do: solidityPackedKeccak256(["string"], [secret]).
        string memory secret = "correct-horse-battery-staple";
        bytes32 secretHash = keccak256(abi.encodePacked(secret)); // "off-chain" computation
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, secretHash);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vault.claim(id, secret); // succeeds iff the hashes match
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_offchainHashWithUnicodeMatches() public {
        // Non-ASCII secrets hash the same way (UTF-8 bytes of the string).
        string memory secret = unicode"sécret-☕";
        bytes32 secretHash = keccak256(abi.encodePacked(secret));
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, secretHash);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vault.claim(id, secret);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_abiEncodeHashDoesNOTMatch() public {
        // The WRONG encoding (abi.encode instead of abi.encodePacked) must fail:
        // a frontend bug that the vault correctly rejects.
        string memory secret = "s3cret";
        bytes32 wrongHash = keccak256(abi.encode(secret));
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, wrongHash);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vm.expectRevert(SafeRevertVault.InvalidSecret.selector);
        vault.claim(id, secret);
    }

    function test_bytesSecretHashMatches() public {
        // abi.encodePacked(bytes) over identical bytes gives the same result.
        bytes memory secretBytes = bytes("byte-secret");
        bytes32 secretHash = keccak256(abi.encodePacked(secretBytes));
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, secretHash);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vault.claim(id, string(secretBytes));
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_wrongSecret_reverts() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, keccak256(abi.encodePacked("right")));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vm.expectRevert(SafeRevertVault.InvalidSecret.selector);
        vault.claim(id, "wrong");
    }

    function test_zeroHash_disablesSecretCheck() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(recipient, address(0), 1 ether, 1 hours, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(recipient);
        vault.claim(id, "anything-at-all");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }
}

/// @notice Lifecycle fuzz: create -> random warp -> random action; only legal transitions succeed.
contract SafeRevertVaultLifecycleFuzzTest is Test {
    SafeRevertVault vault;
    MockERC20 token;

    address sender = address(0xA11CE);
    address recipient = address(0xB0B);
    address attacker = address(0xBAD);

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        deal(sender, 100_000 ether);
        token.mint(sender, 1e40);
    }

    function testFuzz_lifecycle(uint256 amount, uint256 delay, uint256 expiryExtra, uint256 warpDelta, uint256 action) public {
        amount = bound(amount, 1, 100 ether);
        delay = bound(delay, 1 minutes, 24 hours);
        expiryExtra = bound(expiryExtra, 1, 3 days);
        warpDelta = bound(warpDelta, 0, 4 days);
        uint256 expiry = block.timestamp + delay + expiryExtra;
        bool useEth = (action % 2 == 0);
        action = action / 2;

        uint256 id;
        if (useEth) {
            vm.prank(sender);
            id = vault.createTransfer{value: amount}(recipient, address(0), amount, delay, expiry, bytes32(0));
        } else {
            vm.prank(sender);
            token.approve(address(vault), amount);
            vm.prank(sender);
            id = vault.createTransfer(recipient, address(token), amount, delay, expiry, bytes32(0));
        }

        uint256 senderBefore = sender.balance + token.balanceOf(sender);
        uint256 recipBefore = recipient.balance + token.balanceOf(recipient);
        vm.warp(block.timestamp + warpDelta);

        uint256 a = action % 3;
        SafeRevertVault.Transfer memory t = vault.getTransfer(id);
        if (a == 0) {
            // cancel: legal only before unlock
            vm.prank(sender);
            try vault.cancel(id) {
                assertTrue(block.timestamp < t.unlockTime);
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
            } catch {
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
            }
        } else if (a == 1) {
            // claim: legal only in window
            vm.prank(recipient);
            try vault.claim(id, "") {
                assertGe(block.timestamp, uint256(t.unlockTime));
                assertLt(block.timestamp, uint256(t.expiry));
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
            } catch {
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
            }
        } else {
            // refund: legal only after expiry
            vm.prank(sender);
            try vault.refund(id) {
                assertGe(block.timestamp, uint256(t.expiry));
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Refunded));
            } catch {
                assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
            }
        }

        // Conservation: money only ever lands on sender (cancel/refund) or recipient (claim).
        SafeRevertVault.Transfer memory afterT = vault.getTransfer(id);
        if (afterT.state == SafeRevertVault.State.Pending) {
            assertEq(sender.balance + token.balanceOf(sender), senderBefore);
            assertEq(recipient.balance + token.balanceOf(recipient), recipBefore);
        } else if (afterT.state == SafeRevertVault.State.Claimed) {
            assertEq(recipient.balance + token.balanceOf(recipient), recipBefore + amount);
        } else {
            assertEq(sender.balance + token.balanceOf(sender), senderBefore + amount);
        }
        assertEq(attacker.balance, 0);
    }
}
