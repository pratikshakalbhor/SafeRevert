# SafeRevert — Test & Security Validation Report

Last run: Foundry 1.8.1, solc 0.8.24, Slither 0.11.6.
**113 tests pass** (50 unit + 13 boundary + 9 validation + 6 secret + 1 lifecycle fuzz
+ 10 fuzz + 15 attack + 8 gas benchmarks + 1 invariant suite with 5 properties).

> **Contract changes in this iteration (deliberate, with tests written first):**
> - Bug A: `createTransfer` accepted `recipient == address(this)` → permanently unclaimable
>   transfer. Fixed: `InvalidRecipient()` now reverts for the vault itself too.
> - Bug B: `expiry` (uint256) cast to `uint64` without a bound → `2^64+5` wrapped to `5`,
>   opening `refund` instantly while `claim` was impossible. Fixed: `InvalidExpiry`
>   reverts when `expiry > type(uint64).max`.
> Both fixes are covered by `SafeRevertVaultValidationTest`. No other behavior changed.

## Bugs found during testing

### Bug A — `recipient == address(this)` accepted (found by code review + test)
- **Cause:** `createTransfer` only checked `recipient != address(0)`. Naming the vault
  itself as recipient creates a transfer that only the vault could `claim`
  (`msg.sender == recipient`), and the vault never calls itself.
- **Impact:** funds locked in the vault from `unlockTime` until `expiry` — claimable by
  nobody; only the sender's `cancel` (before unlock) / `refund` (after expiry) can free them.
- **Fix:** `if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();`
- **Proving test:** `SafeRevertVaultValidationTest::test_vaultItselfAsRecipient_reverts`
  (before the fix, a bug-demo test created the transfer successfully and showed no account
  could claim it; after the fix it reverts `InvalidRecipient`).

### Bug B — `expiry` truncated from uint256 to uint64 on store (found by code review + test)
- **Cause:** `expiry` (uint256) was cast with `uint64(expiry)` and stored without a bound,
  although the `expiry > unlockTime` check ran on the untruncated uint256.
- **Impact:** `expiry = 2^64 + 5` passes the check but stores `5`. On any real network
  (timestamps ~1.7e9 > 5) `claim` is impossible at every instant (`TooEarly` before unlock,
  `Expired` after), while `refund` succeeds immediately — the escrow timelock is silently
  bypassed and the intended recipient can never receive funds.
- **Fix:** `if (expiry > type(uint64).max) revert InvalidExpiry(expiry, unlockTime);`
  (with a comment explaining the truncation risk). `unlockTime` needed no bound because it is
  `block.timestamp + delay` with `delay <= 24 hours`.
- **Proving tests:** `SafeRevertVaultValidationTest::test_expiryAboveUint64Max_reverts`
  (+ `test_expiryAtUint64Max_accepted` for the boundary), and a bug-demo test that showed
  the truncated stored expiry `5` with instant refund before the fix.

## Test files

| File | What it covers |
|---|---|
| `test/SafeRevertVault.t.sol` | 50 unit tests (every function + revert path) + 13 boundary tests (`vm.warp` at exact instants) + 9 validation/input tests + 6 secret-encoding tests + 1 lifecycle fuzz |
| `test/SafeRevertVault.invariant.t.sol` + `test/mocks/VaultHandler.sol` | Handler-based invariants with ghost variables |
| `test/Fuzz.t.sol` | 10 fuzz tests: random amounts/delays/expiries/timestamps (256 runs each) |
| `test/Attack.t.sol` | 15 attack tests: reentrancy (recipient/sender/hook), front-run, double claim/cancel, cancel-after-claim, wrong secret, non-payable recipient |
| `test/Gas.t.sol` | 8 gas benchmarks split ETH vs ERC-20 |
| `test/mocks/MockERC20.sol`, `MockFeeToken.sol` | Standard ERC-20 + fee-on-transfer (10% and 100%) |
| `test/mocks/MaliciousRecipient.sol` | Reverting + reentrant ETH receivers |
| `test/mocks/HookToken.sol` | ERC-777-style `tokensReceived` hook token + reentrant hook attacker |

## Commands

```bash
forge build
forge test -vvv
forge coverage --report summary
forge test --gas-report
forge test --match-contract GasBenchmark -vvv   # split ETH/ERC-20 gas numbers
slither . --filter-paths "lib|test" --print human-summary
```

CI: `.github/workflows/test.yml` runs `forge build --sizes`, `forge test -vvv`,
`forge coverage`, and Slither (with `filter-paths: 'lib|test'`) on every push.

## Answers to the validation questions

**(a)** `claim(uint256 id, string calldata secret)` — `secret` is a **`string`**; checked with
`keccak256(abi.encodePacked(secret))` against the stored hash (skipped when `secretHash == 0`).

**(b)** `recipient != address(0)`: yes. `amount > 0`: yes (plus zero-received check for tokens).
`recipient != address(this)`: **was missing — now fixed** (Bug A above).

**(c)** `msg.value == 0` required for ERC-20 transfers: **yes** (`MsgValueMismatch` otherwise);
for ETH, `msg.value` must equal `amount` exactly.

**(d)** ETH payout checks the `.call` result: **yes** — reverts `EthTransferFailed()` on failure
(the whole claim/cancel/refund rolls back, so the transfer stays `Pending`).

## Invariant results (runs: 64, calls: 1280, reverts: 0, discards: 0)

- Vault ETH balance == ghost sum of Pending ETH amounts ✅
- Vault token balance == ghost sum of Pending token amounts ✅
- No claim before `unlockTime` ✅ (`claimTimes[id] >= unlockTime`)
- Terminal states (`Cancelled`/`Claimed`/`Refunded`) never change ✅
- Ghost sums match a fresh scan of `getTransfer(i)` for all `i < nextId` ✅
- Handler inline assertions per call: cancel/refund pay the sender **exactly** the deposit;
  claim increases **only** the stored recipient (attacker untouched).

## Attack results (15/15 pass)

- Reentrancy via malicious recipient's `receive()` on `claim` (claim/cancel/refund reentry) — no double payout.
- Reentrancy via malicious sender's `receive()` on `cancel` and on `refund` — no double payout.
- ERC-777-style hook: recipient's `tokensReceived` reenters all three functions on the claim
  payout — blocked (`NotPending` + `ReentrancyGuard` + CEI); exactly one payout.
- Front-run with a copied secret — attacker gets `NotRecipient`; funds go only to the stored recipient.
- Double claim / double cancel / cancel-after-claim — `NotPending`.
- Recipient contract with no payable `receive()` — claim reverts `EthTransferFailed`, funds stay in vault (documented limitation).
- Hook token deposit/payout flows normally when the vault itself isn't hooked ✅.

## Slither (`slither . --filter-paths "lib|test"`)

**0 high, 0 medium, 5 low, 1 informational.**

| Finding | Severity | Location | Resolution |
|---|---|---|---|
| `timestamp` ×5 | Low | `createTransfer`/`cancel`/`claim`/`refund`/`getTransfer` | **Accepted.** `block.timestamp` is the mechanism of a time-locked escrow; validator skew (seconds) is negligible vs. 1-min min delay / 24-h max delay. (The `getTransfer` hit is a grouping artifact — it's the `sender == address(0)` existence check.) |
| `low-level-calls` | Informational | `_payout` `.call{value:}` | **Accepted.** `.call` is the only correct ETH payout (`.transfer` gas stipend is deprecated); CEI + `nonReentrant` + fixed targets cover reentrancy. Result checked (`EthTransferFailed`). |
| `incorrect-equality` | Medium | `createTransfer` `lockedAmount == 0` | **False positive, annotated** `// slither-disable-next-line incorrect-equality` with rationale (fresh balance-delta just received). No behavior change. |
| `assembly`, `pragma`, `solc-version` (×18) | Informational | `lib/` only | Filtered out by `--filter-paths "lib|test"`; dependency code, not ours. |

## Gas report

Split benchmark (`forge test --match-contract GasBenchmark -vvv`, includes prank/cheatcode overhead):

| Function | ETH | ERC-20 |
|---|---:|---:|
| `createTransfer` | 164,803 | 265,270 |
| `cancel` | 64,032 | 67,633 |
| `claim` | 68,760 | 89,461 |
| `refund` | 63,991 | 67,592 |

Aggregated report (`forge test --gas-report`): `createTransfer` avg 138,888 · `cancel` avg
52,142 · `claim` avg 51,475 · `refund` avg 38,485 · `getTransfer` avg 16,130 · `nextId`
2,371. Deployed size: **3,330 bytes**.

## Coverage (`forge coverage --report summary`)

`contracts/SafeRevertVault.sol`: **100.00% lines (61/61), 100.00% statements (89/89),
100.00% branches (28/28), 100.00% functions (7/7)** — includes the two new validation branches.

## Remaining weaknesses / notes (not bugs)

- **Rebasing / fee-on-outbound tokens**: vault ledger records `Transfer.amount` at deposit;
  tokens with transfer taxes on payout deliver less to the recipient (documented limitation;
  same for rebasing supply changes). Standard/non-standard ERC-20s are unaffected.
- **Recipients without payable `receive()`**: claim reverts and funds stay until `expiry`
  (sender refund is the escape hatch) — by design, no redirect/rescue function.
- **`secret` is `string`**: frontends must compute `keccak256(abi.encodePacked(secret))`
  over the string's UTF-8 bytes (`solidityPackedKeccak256(["string"],[secret])`).
  `abi.encode` is wrong and correctly rejected (pinned by `test_abiEncodeHashDoesNOTMatch`).
- **`createTransfer`'s external call precedes storage** (CEI deviation) — covered by
  `nonReentrant`; hook-token/ERC-777 reentry during deposit was tested and blocked.
