// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeRevertVault} from "../contracts/SafeRevertVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MaliciousRecipient, RevertingReceiver} from "./mocks/MaliciousRecipient.sol";
import {HookToken, HookAttacker} from "./mocks/HookToken.sol";

/// @notice Attack tests: reentrancy, mempool front-running, double claim, wrong secret.
contract AttackTest is Test {
    SafeRevertVault vault;
    MockERC20 token;
    MaliciousRecipient evil;
    RevertingReceiver reverting;

    address sender = address(0xA11CE);
    address honestRecipient = address(0xB0B);
    address attacker = address(0xE711);
    address bystander = address(0xBEEF);

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        evil = new MaliciousRecipient();
        reverting = new RevertingReceiver();
        evil.setVault(address(vault));
        deal(sender, 100 ether);
        deal(address(evil), 1 ether);
        deal(attacker, 10 ether);
        token.mint(sender, 1_000_000 ether);
    }

    // ---- 1. Reentrancy via malicious recipient contract (ETH) ----
    function test_reentrancy_claimCannotDoublePay() public {
        uint256 amount = 5 ether;
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: amount}(address(evil), address(0), amount, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 minutes);
        evil.arm(id, "");
        uint256 before = address(evil).balance;
        evil.claimAttack();
        // Only one payout of `amount` landed despite 3 reentry attempts in receive().
        assertEq(address(evil).balance, before + amount);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
        assertTrue(evil.attacked());
        assertEq(evil.reentryAttempts(), 3);
        assertEq(address(vault).balance, 0);
    }

    function test_reentrancy_cancelByRecipientReverts() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(address(evil), address(0), 1 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        // Recipient calling claim before unlock -> TooEarly (not a successful reentry path)
        uint256 unlock = vault.getTransfer(id).unlockTime;
        vm.prank(address(evil));
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.TooEarly.selector, id, unlock));
        vault.claim(id, "");
        // And recipient can never cancel someone else's transfer
        vm.prank(address(evil));
        vm.expectRevert(abi.encodeWithSignature("NotSender(uint256,address)", id, address(evil)));
        vault.cancel(id);
    }

    function test_reentrancy_secondClaimRevertsNotPending() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 3 ether}(address(evil), address(0), 3 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 minutes);
        evil.arm(id, "");
        evil.claimAttack();
        // State already terminal: a fresh claim reverts even though funds existed once.
        SafeRevertVault.State terminal = vault.getTransfer(id).state;
        vm.prank(address(evil));
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, terminal));
        vault.claim(id, "");
        assertEq(address(evil).balance, 1 ether + 3 ether);
    }

    function test_revertingReceiver_ClaimRevertsAndFundsStayPending() public {
        uint256 amount = 2 ether;
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: amount}(address(reverting), address(0), amount, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(address(reverting));
        // receive() reverts -> _payout reverts EthTransferFailed, but state transition
        // is rolled back with the revert so the transfer stays Pending (documented limitation).
        vm.expectRevert(SafeRevertVault.EthTransferFailed.selector);
        vault.claim(id, "");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
        assertEq(address(vault).balance, amount);
    }

    function test_maliciousSenderCancelCannotReenter() public {
        // A sender contract whose receive() tries to reenter should not double-payout.
        SenderAttacker s = new SenderAttacker(vault, token);
        // Fund the attacker contract (it calls createTransfer as msg.sender)
        deal(address(s), 10 ether);
        uint256 amount = 2 ether;
        uint256 id = s.createAndAttackCancel(amount);
        assertEq(address(s).balance, 10 ether); // deposits then refunds exactly amount
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Cancelled));
        assertTrue(s.reentered());
        assertEq(address(vault).balance, 0);
    }

    // ---- 2. Front-running claim with copied secret ----
    function test_frontRun_copiedSecretDoesNotTransferFundsToAttacker() public {
        string memory secret = "top-secret-value";
        bytes32 hash = keccak256(abi.encodePacked(secret));
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 5 ether}(honestRecipient, address(0), 5 ether, 1 minutes, block.timestamp + 2 days, hash);
        vm.warp(block.timestamp + 1 minutes);
        // Attacker sees `secret` in mempool and races the recipient.
        uint256 attBefore = attacker.balance;
        uint256 recipBefore = honestRecipient.balance;
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("NotRecipient(uint256,address)", id, attacker));
        vault.claim(id, secret); // correct secret, wrong caller -> still reverts
        assertEq(attacker.balance, attBefore);
        // Honest recipient claims; funds go to stored recipient, never to the front-runner.
        vm.prank(honestRecipient);
        vault.claim(id, secret);
        assertEq(honestRecipient.balance, recipBefore + 5 ether);
        assertEq(attacker.balance, attBefore);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_frontRun_attackerCannotRefundOrCancelOthersTransfer() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(honestRecipient, address(0), 1 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("NotSender(uint256,address)", id, attacker));
        vault.cancel(id);
        vm.warp(block.timestamp + 2 days);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("NotSender(uint256,address)", id, attacker));
        vault.refund(id);
    }

    // ---- 3. Double claim ----
    function test_doubleClaim_secondReverts() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 4 ether}(honestRecipient, address(0), 4 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(honestRecipient);
        vault.claim(id, "");
        SafeRevertVault.State terminal = vault.getTransfer(id).state;
        vm.prank(honestRecipient);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, terminal));
        vault.claim(id, "");
    }

    function test_doubleClaim_eRC20SecondReverts() public {
        vm.prank(sender);
        token.approve(address(vault), 10 ether);
        vm.prank(sender);
        uint256 id = vault.createTransfer(honestRecipient, address(token), 10 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(honestRecipient);
        vault.claim(id, "");
        uint256 bal = token.balanceOf(honestRecipient);
        SafeRevertVault.State terminal = vault.getTransfer(id).state;
        vm.prank(honestRecipient);
        vm.expectRevert(abi.encodeWithSelector(SafeRevertVault.NotPending.selector, id, terminal));
        vault.claim(id, "");
        assertEq(token.balanceOf(honestRecipient), bal);
    }

    // ---- 4. Wrong secret ----
    function test_wrongSecret_revertsAndFundsStay() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 2 ether}(honestRecipient, address(0), 2 ether, 1 minutes, block.timestamp + 2 days, keccak256(abi.encodePacked("right")));
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(honestRecipient);
        vm.expectRevert(SafeRevertVault.InvalidSecret.selector);
        vault.claim(id, "wrong");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Pending));
        assertEq(address(vault).balance, 2 ether);
        // Correct secret still works afterwards.
        vm.prank(honestRecipient);
        vault.claim(id, "right");
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
    }

    function test_wrongSecret_emptyAgainstNonZeroHash() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(honestRecipient, address(0), 1 ether, 1 minutes, block.timestamp + 2 days, keccak256(abi.encodePacked("x")));
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(honestRecipient);
        vm.expectRevert(SafeRevertVault.InvalidSecret.selector);
        vault.claim(id, "");
    }

    // ---- Extra: claim to a fresh address chosen at claim time is impossible ----
    function test_claimCannotRedirectToCallerChosenAddress() public {
        vm.prank(sender);
        uint256 id = vault.createTransfer{value: 1 ether}(honestRecipient, address(0), 1 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 minutes);
        // Bystander calls claim directly — contract has no destination parameter at all.
        vm.prank(bystander);
        vm.expectRevert(abi.encodeWithSignature("NotRecipient(uint256,address)", id, bystander));
        vault.claim(id, "");
        assertEq(bystander.balance, 0);
    }

    // ---- ERC-777-style hook token attempting reentrancy on claim ----
    function test_hookToken_reentryOnClaimBlocked() public {
        HookToken hook = new HookToken();
        HookAttacker h = new HookAttacker();
        h.setVault(address(vault));
        hook.mint(sender, 1000 ether);
        // Opt the attacker into receiving tokensReceived (like ERC-777 registration):
        vm.prank(address(h));
        hook.setHookEnabled(true);

        vm.prank(sender);
        hook.approve(address(vault), 100 ether);
        vm.prank(sender);
        uint256 id = vault.createTransfer(address(h), address(hook), 100 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));

        vm.warp(block.timestamp + 1 minutes);
        h.arm(id);
        uint256 before = hook.balanceOf(address(h));
        h.claimAttack();
        // Hook fired during payout, every reentrant attempt failed, exactly one payout landed:
        assertTrue(h.attacked());
        assertEq(hook.balanceOf(address(h)), before + 100 ether);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Claimed));
        assertEq(hook.balanceOf(address(vault)), 0);
    }

    function test_hookToken_vaultNotHooked_uninterruptedFlow() public {
        // Vault never opts in, so deposits and payouts work normally for hook tokens.
        HookToken hook = new HookToken();
        hook.mint(sender, 100 ether);
        vm.prank(sender);
        hook.approve(address(vault), 50 ether);
        vm.prank(sender);
        uint256 id = vault.createTransfer(honestRecipient, address(hook), 50 ether, 1 minutes, block.timestamp + 2 days, bytes32(0));
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(honestRecipient);
        vault.claim(id, "");
        assertEq(hook.balanceOf(honestRecipient), 50 ether);
    }

    // ---- Reentrancy through a malicious sender on refund ----
    function test_maliciousSenderRefundCannotReenter() public {
        SenderAttacker2 s = new SenderAttacker2(vault, token);
        deal(address(s), 10 ether);
        uint256 amount = 2 ether;
        uint256 id = s.createAndAttackRefund(amount);
        // Warp past expiry (1 day), then the contract refunds itself:
        vm.warp(block.timestamp + 1 days);
        s.doRefund();
        assertEq(address(s).balance, 10 ether);
        assertEq(uint8(vault.getTransfer(id).state), uint8(SafeRevertVault.State.Refunded));
        assertTrue(s.reentered());
        assertEq(address(vault).balance, 0);
    }
}

/// @notice Sender contract that attacks via receive() during cancel payout.
contract SenderAttacker {
    SafeRevertVault public vault;
    MockERC20 public token;
    bool public reentered;
    uint256 public cancelId;
    bool private _inside;

    constructor(SafeRevertVault vault_, MockERC20 token_) {
        vault = vault_;
        token = token_;
    }

    function createAndAttackCancel(uint256 amount) external returns (uint256) {
        uint256 id = vault.createTransfer{value: amount}(address(this), address(0), amount, 1 minutes, block.timestamp + 2 days, bytes32(0));
        cancelId = id;
        vault.cancel(id);
        return id;
    }

    receive() external payable {
        if (!_inside) {
            _inside = true;
            reentered = true;
            // Try to cancel the same id again (already terminal) and refund it.
            (bool a, ) = address(vault).call(abi.encodeWithSignature("cancel(uint256)", cancelId));
            (bool b, ) = address(vault).call(abi.encodeWithSignature("refund(uint256)", cancelId));
            require(!a && !b, "reentry succeeded");
            _inside = false;
        }
    }
}

/// @notice Sender contract that attacks via receive() during refund payout.
contract SenderAttacker2 {
    SafeRevertVault public vault;
    MockERC20 public token;
    bool public reentered;
    uint256 public refundId;
    bool private _inside;

    constructor(SafeRevertVault vault_, MockERC20 token_) {
        vault = vault_;
        token = token_;
    }

    function createAndAttackRefund(uint256 amount) external returns (uint256) {
        uint256 id = vault.createTransfer{value: amount}(address(0xB0B), address(0), amount, 1 minutes, block.timestamp + 1 days, bytes32(0));
        refundId = id;
        return id;
    }

    /// @notice Calls refund (after the test warps past expiry) so the payout hits receive().
    function doRefund() external {
        vault.refund(refundId);
    }

    receive() external payable {
        if (!_inside) {
            _inside = true;
            reentered = true;
            (bool a, ) = address(vault).call(abi.encodeWithSignature("refund(uint256)", refundId));
            (bool b, ) = address(vault).call(abi.encodeWithSignature("cancel(uint256)", refundId));
            require(!a && !b, "reentry succeeded");
            _inside = false;
        }
    }
}
