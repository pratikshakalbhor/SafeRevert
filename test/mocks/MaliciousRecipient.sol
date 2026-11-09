// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeRevertVault} from "../../contracts/SafeRevertVault.sol";

/// @notice Malicious recipient that tries to reenter the vault on ETH payout.
/// @dev `receive()` fires a single round of reentrant attempts (claim again, cancel,
/// refund) via low-level calls so the attack "succeeds" in being attempted even when
/// it reverts — the test then asserts no double payout happened.
contract MaliciousRecipient {
    SafeRevertVault public vault;
    uint256 public attackId;
    string public attackSecret;
    bool public attacked;
    uint256 public reentryAttempts;

    /// @notice Stores the vault under attack.
    function setVault(address vault_) external {
        vault = SafeRevertVault(vault_);
    }

    /// @notice Arms the attack for `id` / `secret`.
    function arm(uint256 id, string calldata secret) external {
        attackId = id;
        attackSecret = secret;
        attacked = false;
        reentryAttempts = 0;
    }

    /// @notice Claims through this contract so the ETH payout hits `receive()`.
    function claimAttack() external {
        vault.claim(attackId, attackSecret);
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            // Reenter claim (should revert: NotPending) and cancel/refund (should revert: NotSender).
            (bool a, ) = address(vault).call(abi.encodeWithSignature("claim(uint256,string)", attackId, attackSecret));
            if (!a) reentryAttempts++;
            (bool b, ) = address(vault).call(abi.encodeWithSignature("cancel(uint256)", attackId));
            if (!b) reentryAttempts++;
            (bool c, ) = address(vault).call(abi.encodeWithSignature("refund(uint256)", attackId));
            if (!c) reentryAttempts++;
        }
    }
}

/// @notice Contract that always reverts on ETH receive (to show payout-failure behavior).
contract RevertingReceiver {
    receive() external payable {
        revert("no ETH please");
    }
}
