// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SafeRevertVault
/// @notice Time-locked transfer escrow that protects users from sending crypto to a wrong address.
/// @dev Funds are locked in this vault and can only be claimed by the stored recipient
/// after `unlockTime` (and before `expiry`) with an optional secret, cancelled by the
/// sender before `unlockTime`, or refunded to the sender after `expiry`.
/// @custom:security-contact security@saferevert.example
contract SafeRevertVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Minimum delay a sender must wait before a transfer becomes claimable.
    uint256 public constant MIN_DELAY = 1 minutes;

    /// @notice Maximum delay a sender must wait before a transfer becomes claimable.
    uint256 public constant MAX_DELAY = 24 hours;

    /// @notice Native-ETH sentinel. Transfers with `token == address(0)` are settled in ETH.
    address public constant NATIVE_TOKEN = address(0);

    /// @notice Lifecycle states of a transfer. Only `Pending` can transition; the other
    /// three states are terminal (no outgoing transitions).
    enum State {
        Pending,
        Cancelled,
        Claimed,
        Refunded
    }

    /// @notice A single locked transfer.
    /// @param sender Address that funded the transfer.
    /// @param recipient Address that is allowed to claim the funds.
    /// @param token ERC-20 token address, or `address(0)` for native ETH.
    /// @param amount Amount locked in the vault (actual amount received for fee-on-transfer tokens).
    /// @param unlockTime Timestamp after which the recipient may claim.
    /// @param expiry Timestamp after which only the sender may refund.
    /// @param secretHash Optional commitment `keccak256(abi.encodePacked(secret))`. Zero disables the secret check.
    /// @param state Current lifecycle state.
    struct Transfer {
        address sender;
        address recipient;
        address token;
        uint256 amount;
        uint64 unlockTime;
        uint64 expiry;
        bytes32 secretHash;
        State state;
    }

    /// @notice Emitted when a new transfer is locked in the vault.
    /// @param id Opaque transfer identifier returned by `createTransfer`.
    /// @param sender Funder of the transfer.
    /// @param recipient Intended recipient.
    /// @param token Token address, or `address(0)` for ETH.
    /// @param amount Amount actually locked (after any fee-on-transfer deduction).
    /// @param unlockTime Timestamp when the claim window opens.
    /// @param expiry Timestamp when the claim window closes and refund opens.
    event TransferCreated(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint64 unlockTime,
        uint64 expiry
    );

    /// @notice Emitted when a pending transfer is cancelled by its sender before unlock.
    /// @param id Cancelled transfer identifier.
    /// @param sender Sender that received the refund.
    /// @param amount Amount refunded.
    event Cancelled(uint256 indexed id, address indexed sender, uint256 amount);

    /// @notice Emitted when a transfer is claimed by its recipient.
    /// @param id Claimed transfer identifier.
    /// @param recipient Recipient that received the funds.
    /// @param amount Amount paid out.
    event Claimed(uint256 indexed id, address indexed recipient, uint256 amount);

    /// @notice Emitted when an expired pending transfer is refunded to its sender.
    /// @param id Refunded transfer identifier.
    /// @param sender Sender that received the refund.
    /// @param amount Amount refunded.
    event Refunded(uint256 indexed id, address indexed sender, uint256 amount);

    /// @notice Raised when `recipient` is the zero address.
    error InvalidRecipient();

    /// @notice Raised when `amount` is zero (or nothing was actually received).
    error InvalidAmount();

    /// @notice Raised when `delay` is outside `[MIN_DELAY, MAX_DELAY]`.
    error InvalidDelay(uint256 delay);

    /// @notice Raised when `expiry` is not after the computed unlock time.
    error InvalidExpiry(uint256 expiry, uint256 unlockTime);

    /// @notice Raised when ETH is sent for an ERC-20 transfer, or the ETH value does not match `amount`.
    error MsgValueMismatch();

    /// @notice Raised when `id` does not exist.
    error TransferNotFound(uint256 id);

    /// @notice Raised when the transfer is not in the `Pending` state.
    error NotPending(uint256 id, State state);

    /// @notice Raised when `msg.sender` is not the transfer's sender.
    error NotSender(uint256 id, address caller);

    /// @notice Raised when `msg.sender` is not the transfer's recipient.
    error NotRecipient(uint256 id, address caller);

    /// @notice Raised when an action is attempted before `unlockTime`.
    error TooEarly(uint256 id, uint256 unlockTime);

    /// @notice Raised when an action is attempted after the claim window has closed.
    error Expired(uint256 id, uint256 expiry);

    /// @notice Raised when a secret does not match the stored hash.
    error InvalidSecret();

    /// @notice Raised when a native-ETH payout fails.
    error EthTransferFailed();

    /// @notice Id counter for the next transfer. First transfer gets id `0`.
    uint256 private _nextId;

    /// @notice All transfers by id. Use `getTransfer` to read a transfer.
    mapping(uint256 id => Transfer) private _transfers;

    /// @notice Creates a new time-locked transfer and locks the funds in this vault.
    /// @dev For `token == address(0)` the caller must send exactly `amount` ETH via `msg.value`
    /// and no ERC-20 allowance is needed. Otherwise exactly `amount` tokens are pulled via
    /// `transferFrom` and the actual amount received (balance before/after, so fee-on-transfer
    /// tokens are supported) is what gets locked. Reentrancy-guarded and follows
    /// checks-effects-interactions.
    /// @param recipient Address allowed to claim the funds after unlock. Must not be `address(0)`.
    /// @param token ERC-20 token address, or `address(0)` for native ETH.
    /// @param amount Amount of ETH (via `msg.value`) or tokens (via `transferFrom`) to lock. Must be > 0.
    /// @param delay Time-lock in seconds. Must be in `[MIN_DELAY, MAX_DELAY]`.
    /// @param expiry Absolute timestamp when the claim window closes. Must be > `unlockTime`
    /// (where `unlockTime = block.timestamp + delay`).
    /// @param secretHash Optional commitment `keccak256(abi.encodePacked(secret))` the recipient
    /// must reveal on `claim`. Use `bytes32(0)` to disable the secret check.
    /// @return id Identifier of the newly created transfer.
    function createTransfer(
        address recipient,
        address token,
        uint256 amount,
        uint256 delay,
        uint256 expiry,
        bytes32 secretHash
    ) external payable nonReentrant returns (uint256 id) {
        // recipient == address(this) would create a transfer nobody can claim (only the
        // vault itself could call claim), so reject it together with the zero address.
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (delay < MIN_DELAY || delay > MAX_DELAY) revert InvalidDelay(delay);

        uint256 unlockTime = block.timestamp + delay;
        if (expiry <= unlockTime) revert InvalidExpiry(expiry, unlockTime);
        // expiry is stored as uint64; reject values that would truncate on the cast
        // (e.g. 2^64 + 5 would otherwise wrap to a tiny stored expiry, opening refund
        // immediately while making claim impossible).
        if (expiry > type(uint64).max) revert InvalidExpiry(expiry, unlockTime);

        uint256 lockedAmount;
        if (token == NATIVE_TOKEN) {
            if (msg.value != amount) revert MsgValueMismatch();
            lockedAmount = amount;
        } else {
            if (msg.value != 0) revert MsgValueMismatch();
            IERC20 erc20 = IERC20(token);
            uint256 balanceBefore = erc20.balanceOf(address(this));
            erc20.safeTransferFrom(msg.sender, address(this), amount);
            uint256 balanceAfter = erc20.balanceOf(address(this));
            lockedAmount = balanceAfter - balanceBefore;
            // False positive: lockedAmount is a fresh balance-delta just received, not a
            // user-controlled balance comparison, so strict equality is the correct check.
            // slither-disable-next-line incorrect-equality
            if (lockedAmount == 0) revert InvalidAmount();
        }

        id = _nextId++;
        _transfers[id] = Transfer({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: lockedAmount,
            unlockTime: uint64(unlockTime),
            expiry: uint64(expiry),
            secretHash: secretHash,
            state: State.Pending
        });

        emit TransferCreated(id, msg.sender, recipient, token, lockedAmount, uint64(unlockTime), uint64(expiry));
    }

    /// @notice Cancels a pending transfer before its unlock time and refunds the full amount to the sender.
    /// @dev Only the sender may cancel, only while the transfer is `Pending`, and only before
    /// `unlockTime`. The state is set to `Cancelled` before the payout (CEI).
    /// @param id Identifier of the transfer to cancel.
    function cancel(uint256 id) external nonReentrant {
        Transfer storage t = _transfers[id];
        if (t.sender == address(0)) revert TransferNotFound(id);
        if (t.state != State.Pending) revert NotPending(id, t.state);
        if (msg.sender != t.sender) revert NotSender(id, msg.sender);
        if (block.timestamp >= t.unlockTime) revert TooEarly(id, t.unlockTime);

        t.state = State.Cancelled;
        _payout(t.token, t.sender, t.amount);

        emit Cancelled(id, t.sender, t.amount);
    }

    /// @notice Claims a pending transfer to the stored recipient after unlock and before expiry.
    /// @dev Only the stored recipient may claim; funds always go to that stored address, never
    /// to an address chosen by `msg.sender` at claim time. If `secretHash` is non-zero the
    /// caller must reveal `secret` such that `keccak256(abi.encodePacked(secret)) == secretHash`.
    /// The state is set to `Claimed` before the payout (CEI).
    /// @param id Identifier of the transfer to claim.
    /// @param secret Secret to reveal. Ignored when the transfer's `secretHash` is `bytes32(0)`; pass `""` then.
    function claim(uint256 id, string calldata secret) external nonReentrant {
        Transfer storage t = _transfers[id];
        if (t.sender == address(0)) revert TransferNotFound(id);
        if (t.state != State.Pending) revert NotPending(id, t.state);
        if (msg.sender != t.recipient) revert NotRecipient(id, msg.sender);
        if (block.timestamp < t.unlockTime) revert TooEarly(id, t.unlockTime);
        if (block.timestamp >= t.expiry) revert Expired(id, t.expiry);
        if (t.secretHash != bytes32(0) && keccak256(abi.encodePacked(secret)) != t.secretHash) {
            revert InvalidSecret();
        }

        t.state = State.Claimed;
        _payout(t.token, t.recipient, t.amount);

        emit Claimed(id, t.recipient, t.amount);
    }

    /// @notice Refunds an expired pending transfer to its sender.
    /// @dev Only the sender may refund, only while the transfer is `Pending`, and only after
    /// `expiry`. The state is set to `Refunded` before the payout (CEI).
    /// @param id Identifier of the transfer to refund.
    function refund(uint256 id) external nonReentrant {
        Transfer storage t = _transfers[id];
        if (t.sender == address(0)) revert TransferNotFound(id);
        if (t.state != State.Pending) revert NotPending(id, t.state);
        if (msg.sender != t.sender) revert NotSender(id, msg.sender);
        if (block.timestamp < t.expiry) revert TooEarly(id, t.expiry);

        t.state = State.Refunded;
        _payout(t.token, t.sender, t.amount);

        emit Refunded(id, t.sender, t.amount);
    }

    /// @notice Returns the stored transfer for a given id.
    /// @param id Identifier of the transfer to read.
    /// @return The stored `Transfer` struct.
    function getTransfer(uint256 id) external view returns (Transfer memory) {
        if (_transfers[id].sender == address(0)) revert TransferNotFound(id);
        return _transfers[id];
    }

    /// @notice Returns the id that the next created transfer will receive.
    /// @return The next transfer identifier.
    function nextId() external view returns (uint256) {
        return _nextId;
    }

    /// @dev Internal payout helper. Sends `amount` of `token` to `to`.
    /// For ETH uses a low-level call and reverts on failure; for ERC-20 uses SafeERC20.
    /// @param token Token address, or `address(0)` for native ETH.
    /// @param to Destination address (always a stored sender/recipient, never caller-supplied).
    /// @param amount Amount to pay out.
    function _payout(address token, address to, uint256 amount) internal {
        if (token == NATIVE_TOKEN) {
            (bool success, ) = to.call{value: amount}("");
            if (!success) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
