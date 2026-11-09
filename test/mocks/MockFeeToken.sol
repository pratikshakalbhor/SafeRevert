// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fee-on-transfer ERC-20 for tests. Burns a configurable fee on every transfer.
/// @dev Senders lose the full `value`; recipients receive `value - fee`; the fee is burned.
contract MockFeeToken is ERC20 {
    uint256 public feeBps;

    constructor(uint256 feeBps_) ERC20("FeeToken", "FEE") {
        require(feeBps_ <= 10_000, "fee too high");
        feeBps = feeBps_;
    }

    /// @notice Mints `amount` tokens to `to`.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Takes the fee on every non-mint/non-burn transfer.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, to, value - fee);
            if (fee > 0) {
                super._update(from, address(0xdead), fee);
            }
        } else {
            super._update(from, to, value);
        }
    }
}
