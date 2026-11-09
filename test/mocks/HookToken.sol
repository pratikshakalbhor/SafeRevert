// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeRevertVault} from "../../contracts/SafeRevertVault.sol";

/// @notice ERC-777-style hook token for attack tests.
/// @dev Recipients that opt in via `setHookEnabled(true)` get a `tokensReceived(operator,
/// from, amount)` callback after every transfer. This mimics ERC-777's hook behavior
/// (where the recipient opts in through a registry) so the vault flow is unaffected
/// unless the recipient explicitly enables hooks on itself.
contract HookToken is ERC20 {
    mapping(address => bool) public hookEnabled;

    constructor() ERC20("HookToken", "HOOK") {}

    /// @notice Mints `amount` tokens to `to` (minting does not fire the hook).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Opts the caller into (or out of) receiving `tokensReceived` after transfers.
    function setHookEnabled(bool enabled) external {
        hookEnabled[msg.sender] = enabled;
    }

    /// @dev ERC-777-style: notify opted-in contract recipients after the balance move.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to != address(0) && from != address(0) && hookEnabled[to]) {
            (bool ok, ) = to.call(abi.encodeWithSignature("tokensReceived(address,address,uint256)", msg.sender, from, value));
            require(ok, "HookToken: hook reverted");
        }
    }
}

/// @notice Malicious contract recipient that tries to reenter the vault from the
/// `tokensReceived` hook during the claim payout.
contract HookAttacker {
    address public vault;
    uint256 public attackId;
    bool public attacked;
    bytes public lastRevert;

    function setVault(address vault_) external {
        vault = vault_;
    }

    function arm(uint256 id) external {
        attackId = id;
        attacked = false;
    }

    /// @notice Claims through this contract so the payout hits the hook.
    function claimAttack() external {
        SafeRevertVault(payable(vault)).claim(attackId, "");
    }

    /// @notice ERC-777-style receipt hook: attempts reentrant claim/cancel/refund.
    function tokensReceived(address, address, uint256) external {
        if (attacked) return;
        attacked = true;
        (bool a, bytes memory r) = vault.call(abi.encodeWithSignature("claim(uint256,string)", attackId, ""));
        if (!a) lastRevert = r;
        (bool b, ) = vault.call(abi.encodeWithSignature("cancel(uint256)", attackId));
        require(!b, "cancel reentry succeeded");
        (bool c, ) = vault.call(abi.encodeWithSignature("refund(uint256)", attackId));
        require(!c, "refund reentry succeeded");
    }
}
