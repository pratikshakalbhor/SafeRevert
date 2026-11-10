# SafeRevert — Time-Locked Transfer Escrow

A small escrow vault that locks crypto for a timelock so a sender can still
reverse a transfer sent to a wrong address before the recipient can claim it.

## Layout

```
SafeRevert/
  contracts/SafeRevertVault.sol   # the vault
  script/Deploy.s.sol             # Foundry deploy script
  test/                           # 113 tests (unit, boundary, fuzz, invariant, attack, gas);
                                  # see SECURITY.md for the full validation report
  frontend/                       # React + TypeScript + Vite + wagmi + viem + RainbowKit dApp
  .github/workflows/test.yml      # CI: forge build + forge test -vvv + coverage + slither
  foundry.toml
  remappings.txt
  lib/                            # openzeppelin-contracts, forge-std
```

## How it works

```
createTransfer ──► Pending ── cancel (sender, before unlock) ──► Cancelled → sender
                   │
                   ├── claim (recipient, unlock ≤ now < expiry, + secret) ──► Claimed → recipient
                   │
                   └── refund (sender, after expiry) ──► Refunded → sender
```

- `createTransfer(recipient, token, amount, delay, expiry, secretHash)` (payable)
  returns a new `id`, locks funds, emits `TransferCreated`.
  - `token == address(0)` = native ETH: `msg.value` must equal `amount`.
  - otherwise ERC-20: pulls `amount` via `SafeERC20.safeTransferFrom` and records the
    *actual* amount received using balance-before/after, so fee-on-transfer tokens work.
  - `delay` (seconds) must be in `[1 minutes, 24 hours]`.
  - `unlockTime = block.timestamp + delay`. `expiry` is an **absolute timestamp** and must
    be `> unlockTime`.
- `cancel(id)` — sender only, only while `Pending` and `block.timestamp < unlockTime`.
  Sets `Cancelled`, pays sender, emits `Cancelled`.
- `claim(id, secret)` — recipient only, only while `Pending` and
  `unlockTime <= block.timestamp < expiry`. Payout always goes to the **stored**
  recipient — `msg.sender` cannot choose a destination at claim time.
  If `secretHash != bytes32(0)`, requires `keccak256(abi.encodePacked(secret)) == secretHash`.
  Sets `Claimed`, pays recipient, emits `Claimed`.
- `refund(id)` — sender only, only while `Pending` and `block.timestamp >= expiry`.
  Sets `Refunded`, pays sender, emits `Refunded`.
- `getTransfer(id)` and `nextId()` are read helpers. Ids start at `0`.

## Security / design decisions

- **State machine:** `Pending → {Cancelled, Claimed, Refunded}`. Terminal states have no
  outgoing transitions; every mutating function asserts `state == Pending`.
- **Checks-effects-interactions:** state is flipped to the terminal value *before* any
  token/ETH payout, and all public fund-moving functions are `nonReentrant`
  (`OpenZeppelin ReentrancyGuard`).
- **Custom errors** everywhere instead of revert strings (`InvalidDelay`, `TooEarly`,
  `Expired`, `NotSender`, …). No revert strings, cheaper deploys.
- **Pull-style funding:** ERC-20 funds are *pulled* from the sender via `transferFrom`
  (allowance required); ETH arrives via `msg.value`. Payouts happen only on explicit
  `cancel`/`claim`/`refund` calls — nothing is pushed automatically.
- **No arbitrary external calls:** the vault only ever interacts with (a) the
  user-supplied `token` via `IERC20.balanceOf` + `SafeERC20` (`transfer`/`transferFrom`),
  and (b) stored sender/recipient addresses for ETH payouts. No `delegatecall`,
  no calls to arbitrary addresses, no callbacks.
- **No unbounded loops:** every function touches exactly one `id` in storage. There is
  no iteration over all transfers, so no pagination / gas-griefing surface.
- **No `receive()`/`fallback()`:** ETH can only enter via `createTransfer`
  (`msg.value == amount` for ETH transfers, `0` otherwise). Accidental ETH is rejected.
- **Fixed payout targets:** `claim` pays the stored `recipient`, `cancel`/`refund` pay
  the stored `sender`. A caller cannot redirect funds.
- **NatSpec on every external function.**

## Frontend dApp

The frontend for SafeRevert is built with React, TypeScript, Vite, wagmi, viem, RainbowKit, and Tailwind CSS in `frontend/`.

### Quick Start

```bash
cd frontend
cp .env.example .env
# Edit .env with your VITE_VAULT_ADDRESS, VITE_SEPOLIA_RPC_URL, VITE_WALLETCONNECT_PROJECT_ID
npm install
npm run dev
```

### Features

- **Send Escrow:** Create ETH or ERC-20 transfers with delay (5m, 15m, 30m, 1h, or custom up to 24h) and absolute expiry window. Computes high-entropy 32-byte secret in memory. One-time reveal modal upon creation.
- **My Transfers:** Direct contract reads (`nextId()` + `getTransfer(id)` over the newest 200 ids, multicall in batches of 50) filtered to transfers where you are sender or recipient — no `eth_getLogs`, so strict free-tier RPC log limits can't break the page. Live count-downs to unlock and expiry with dynamic action buttons (Cancel before unlock, Refund after expiry, Claim link).
- **Claim:** Direct lookup and claim flow. Pre-checks `keccak256(toBytes(secret))` in the browser against on-chain hash commitment before submitting transaction to protect user from failed gas charges.
- **Safety First:** Secrets are never written to `localStorage`, `sessionStorage`, URL parameters, or console logs. Decodes contract custom errors (`TooEarly`, `Expired`, `InvalidSecret`, etc.) into clear user messages.
- **Unit Tests:** Vitest test suite for pure crypto and time helpers (`npm test`).

## Deployment

```bash
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge install foundry-rs/forge-std --no-git
forge build

forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PK --broadcast
# e.g. --rpc-url sepolia --verify
```

## Validation summary

- **113 tests pass**: 50 unit + 13 boundary (`vm.warp` edge instants) + 9 input validation
  + 6 secret-encoding + 1 lifecycle fuzz + 10 fuzz (×256 runs) + 15 attack (reentrancy,
  front-run, double claim/cancel, ERC-777 hook) + 8 gas benchmarks + 1 invariant suite
  (64 runs, 1280 handler calls, 0 reverts).
- **Coverage** (`forge coverage --report summary`): `contracts/SafeRevertVault.sol` —
  100.00% lines (61/61), statements (89/89), branches (28/28), functions (7/7).
- **Slither** (`slither . --filter-paths "lib|test"`): **0 high, 0 medium**, 5 low (all
  `timestamp`, inherent to time-locks), 1 informational (`.call` payout).
- **Tests:** `forge test -vvv` · **Gas:** `forge test --gas-report` · **CI:** `.github/workflows/test.yml`
- Deployed size: **3,330 bytes** (under the 24,576 runtime limit).

See [SECURITY.md](SECURITY.md) for the full report, including the two bugs found during
testing and their fixes.

## Known limitations

- **`block.timestamp` manipulation:** unlock/expiry comparisons can be shifted by
  validators by a few seconds. Fine for 1-minute–24-hour windows; do not reuse this
  pattern for sub-second timing.
- **Secret design:** the secret is revealed on-chain at claim time (visible in mempool/
  calldata). That's acceptable because the payout is already bound to the stored
  recipient — an observer cannot redirect funds — but the secret itself is public
  forever. Use high-entropy secrets; a low-entropy secret can be brute-forced
  offline from `secretHash`. `keccak256(abi.encodePacked(secret))` is used per spec;
  if you later support structured/non-string secrets, prefer `abi.encode` to avoid
  packing ambiguity. `secretHash == bytes32(0)` disables the check entirely.
- **Token quirks:** fee-on-transfer is handled via balance-before/after, and
  `SafeERC20` handles non-standard (missing-return) tokens. Still unsupported in
  practice: rebasing/reflection tokens whose balance changes over time (vault ledger
  vs. actual balance can drift), pausable/blacklisting tokens (payouts may revert),
  tokens that take a fee on *outbound* transfers (recipient receives less than
  `Transfer.amount`), and ERC-777-style hooks (mitigated by CEI + `nonReentrant`).
  Test with your actual token before going live.
- **ETH payouts can revert:** `cancel`/`claim`/`refund` push ETH with `.call`. If the
  stored sender/recipient is a contract without a payable `receive()`/`fallback()`
  that doesn't revert, the payout (and thus the whole call) reverts. There is
  intentionally **no rescue/redirect function** — use EOAs or receive-capable
  contracts as sender/recipient.
- **No rescue/sweep:** ERC-20s or ETH sent directly to the vault (not via
  `createTransfer`), or ETH forced via `selfdestruct`, are stuck by design. This
  keeps the vault trust-minimized but means a fat-fingered direct transfer is
  unrecoverable. An admin sweep would trade that for admin trust.
- **Boundary semantics (exact):** `cancel` requires `now < unlockTime`;
  `claim` requires `unlockTime <= now < expiry`; `refund` requires `now >= expiry`.
  At `now == unlockTime` you can claim but no longer cancel; at `now == expiry`
  you can refund but no longer claim.
- **Lost keys = stuck funds:** if the recipient loses their key, the sender cannot
  reclaim before `expiry`. After `expiry`, anyone watching can call `refund`
  (well, only the sender — so the sender must also have their key). Choose `expiry`
  carefully: too short and the recipient may miss the window; too long and the
  sender's funds are locked longer than intended.
- **No upgrade path:** logic and storage are fixed at deployment. A bug fix means
  a new deployment and migrating open transfers (which the vault does not support).
- **Event-order lint:** `reentrancy-events` (event emitted after external call) is
  intentionally kept — the state transition already happened before the payout, so
  a failed payout reverts the whole transaction including the event. Off-chain
  indexers will always see events only for successful payouts.
