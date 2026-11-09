// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeRevertVault} from "../contracts/SafeRevertVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {VaultHandler} from "./mocks/VaultHandler.sol";

/// @notice Handler-based invariant tests. Handler asserts (exact-cancel amounts,
/// recipient-only payouts, no early claim) run inline; the invariant functions below
/// verify vault-level accounting and state-machine persistence.
contract InvariantTest is Test {
    SafeRevertVault vault;
    MockERC20 token;
    VaultHandler handler;

    function setUp() public {
        vault = new SafeRevertVault();
        token = new MockERC20("Mock", "MCK");
        handler = new VaultHandler(vault, token);
        targetContract(address(handler));
        deal(address(handler), 1 ether);
        vm.warp(1_000_000);
    }

    /// @dev Vault ETH balance always equals the sum of all Pending ETH transfer amounts.
    function invariant_vaultEthBalanceEqualsPendingSum() public view {
        assertEq(address(vault).balance, handler.sumEthPending());
    }

    /// @dev Vault ERC-20 balance always equals the sum of all Pending transfer amounts.
    function invariant_vaultTokenBalanceEqualsPendingSum() public view {
        assertEq(token.balanceOf(address(vault)), handler.sumTokenPending());
    }

    /// @dev A transfer can never be claimed before unlockTime.
    function invariant_noClaimBeforeUnlock() public view {
        uint256 n = vault.nextId();
        for (uint256 i = 0; i < n; i++) {
            SafeRevertVault.Transfer memory t = vault.getTransfer(i);
            if (t.state == SafeRevertVault.State.Claimed) {
                assertGe(handler.claimTimes(i), uint256(t.unlockTime));
            }
        }
    }

    /// @dev A Cancelled, Claimed or Refunded transfer can never change state again.
    function invariant_terminalStatesFrozen() public view {
        uint256 n = vault.nextId();
        for (uint256 i = 0; i < n; i++) {
            SafeRevertVault.Transfer memory t = vault.getTransfer(i);
            if (handler.hasFinal(i)) {
                assertEq(uint8(t.state), handler.finalState(i));
                assertTrue(t.state != SafeRevertVault.State.Pending);
            }
        }
    }

    /// @dev Cross-check pending-sum ghosts against the vault's own view of Pending amounts.
    function invariant_pendingSumMatchesVaultView() public view {
        uint256 n = vault.nextId();
        uint256 ethSum;
        uint256 tokenSum;
        for (uint256 i = 0; i < n; i++) {
            SafeRevertVault.Transfer memory t = vault.getTransfer(i);
            if (t.state == SafeRevertVault.State.Pending) {
                if (t.token == address(0)) ethSum += t.amount;
                else tokenSum += t.amount;
            }
        }
        assertEq(ethSum, handler.sumEthPending());
        assertEq(tokenSum, handler.sumTokenPending());
    }
}
