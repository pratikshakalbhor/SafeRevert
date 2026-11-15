# SafeRevert — Time-Locked Transfer Escrow

![CI](https://github.com/pratikshakalbhor/SafeRevert/actions/workflows/test.yml/badge.svg)

A small escrow vault that locks crypto for a timelock so a sender can still
reverse a transfer sent to a wrong address before the recipient can claim it.

SafeRevert protects against **mistakes** — a typo'd address, an address-poisoning
entry copied out of your own transaction history, a transfer you sent before you
had a chance to double-check — by holding the funds for a short delay in which the
sender can still cancel. It does not protect against **fraud**: if the counterparty
is dishonest, a time-lock and a secret do not turn a bad trade into a good one, and
a sender who cancels at the last moment is still able to do so. The contract has not
been audited, and the only deployment is on the Sepolia testnet.

## Motivation

- **Transfers are irreversible.** An on-chain transfer has no chargeback and no
  "undo" button: once the funds sit in someone else's wallet, only that wallet can
  move them again.
- **Wrong addresses.** A typo, a truncated address, or a stale address left in the
  clipboard sends funds to a party that has no reason to return them.
- **Address poisoning.** An attacker can send a tiny amount from an address that
  looks like one of yours. That address then shows up in your transaction history,
  and the next time you copy a "recent" address from a block explorer you may send
  real funds to the attacker.
- **The delay window.** SafeRevert turns an irreversible send into a reversible one
  for a bounded period: the funds sit in the vault, the sender can cancel until the
  unlock time, and only then can the recipient claim. The cost is that the recipient
  has to wait.

## Related work

Several projects attack the same problem from different angles — see their docs
for the current details:

- **Safe's Delay Module** — adds a waiting period to transactions sent from a Safe
  account, so a transaction can still be cancelled before it executes. See their docs.
- **ERC-20R** — a proposal for reversible ERC-20 tokens, where the token issuer can
  block or reverse transfers. See their docs.
- **Hashlock / escrow claim-link services** — payment links that carry a hash
  commitment, so the recipient has to reveal a secret before the funds can be
  claimed. See their docs.

SafeRevert differs in three ways:

1. **Time-lock plus an optional secret.** The vault combines a delay window
   (1 minute – 24 hours) with an optional hashlock: a transfer can require the
   recipient to reveal a secret whose `keccak256` matches the stored commitment
   before claiming.
2. **The funds always go to the stored recipient.** `claim` pays the address stored
   at creation time; the caller cannot choose a payout destination, so an observer
   who copies the secret out of the mempool cannot redirect the money — the claim
   simply fails with `NotRecipient`.
3. **No token issuer involved.** Nothing about the token changes and no third party
   is trusted: the escrow is a single contract with fixed payout targets and no
   upgrade path.

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

## Threat model

### What SafeRevert protects against

| Threat | How it is handled |
|---|---|
| Typos / wrong address | The sender can `cancel` until `unlockTime` and gets the funds back. |
| Address poisoning caught in time | Same window: if the poisoned address is noticed before the unlock, the transfer is cancelled. |
| Claim front-running | The payout target is the stored recipient, not `msg.sender`; a copied secret or a raced claim from a third party gets `NotRecipient`. |
| Third parties touching a transfer | Only the stored sender and the stored recipient can act on a transfer; there is no arbitrary-call function, no admin and no sweep function. |
| Reentrancy | Checks-effects-interactions on every fund-moving path plus `nonReentrant` (`OpenZeppelin ReentrancyGuard`). |
| A recipient key compromised before the unlock | The claim window has not opened yet, so the compromised key cannot claim early; the sender can still cancel. |

### What SafeRevert does not protect against

- **Mistakes that are not caught before the unlock.** After `unlockTime` the sender can
  no longer cancel.
- **Fraud against the recipient.** A dishonest sender can cancel right up to the unlock
  time. SafeRevert is not a guarantee of payment.
- **A stolen sender key.** An attacker with the sender's key can create transfers and
  cancel them; a time-lock does nothing about key compromise.
- **Phishing and malicious dApps.** A transaction signed on a phishing site is still a
  valid transaction. SafeRevert only limits what a correct client does.
- **Blacklistable or rebasing tokens.** A token that can freeze/blacklist the vault, or
  whose balance changes over time, can break the payout — the vault holds no admin
  rights over the token.
- **No audit.** The contract has not been audited, has not been formally verified, and
  is not production ready.

**Status: the contract is not audited and is deployed on the Sepolia testnet only.**
There is no mainnet deployment, and there is no upgrade path — a bug fix means a new
deployment, and the vault does not support migrating open transfers.

## Frontend dApp

The frontend for SafeRevert is built with React, TypeScript, Vite, wagmi, viem, RainbowKit, and Tailwind CSS in `frontend/`.

### Routes

| Route | Page | Access |
|---|---|---|
| `/` | Home | public |
| `/security` | Security notes and threat model | public |
| `/dashboard` | Overview of your transfers | wallet |
| `/send` | Create an escrow transfer | wallet |
| `/transfers` | Your transfers (as sender or recipient) | wallet |
| `/transfers/:id` | Details and actions for one transfer | wallet |
| `/claim` and `/claim/:id` | Claim a transfer (secret required if the transfer has one) | wallet |
| `*` | 404 | public |

**Wallet = login.** There is no account system: no email, no password, no user
database and no session cookie. Connecting a wallet *is* the sign-in — the protected
routes only render for a connected account, and the connected address is the identity
the app filters transfers by. The secret is always typed in by the user and is never
placed in a URL.

### Quick Start

```bash
cd frontend
cp .env.example .env
# Edit .env with your VITE_VAULT_ADDRESS, VITE_SEPOLIA_RPC_URL, VITE_WALLETCONNECT_PROJECT_ID
npm install
npm run dev
```

`VITE_DEPLOY_BLOCK` is not required any more: transfers are loaded with direct
contract reads (`nextId()` + `getTransfer(id)`) instead of log scans, so no deploy
block is needed.

### Features

- **Send Escrow:** Create ETH or ERC-20 transfers with delay (5m, 15m, 30m, 1h, or custom up to 24h) and absolute expiry window. Computes high-entropy 32-byte secret in memory. One-time reveal modal upon creation.
- **My Transfers:** Direct contract reads (`nextId()` + `getTransfer(id)` over the newest 200 ids, multicall in batches of 50) filtered to transfers where you are sender or recipient — no `eth_getLogs`, so strict free-tier RPC log limits can't break the page. Live count-downs to unlock and expiry with dynamic action buttons (Cancel before unlock, Refund after expiry, Claim link).
- **Claim:** Direct lookup and claim flow. Pre-checks `keccak256(toBytes(secret))` in the browser against on-chain hash commitment before submitting transaction to protect user from failed gas charges.
- **Safety First:** Secrets are never written to `localStorage`, `sessionStorage`, URL parameters, or console logs. Decodes contract custom errors (`TooEarly`, `Expired`, `InvalidSecret`, etc.) into clear user messages.
- **Unit Tests:** Vitest test suite for pure crypto and time helpers (`npm test`).

### Tests

**62 frontend tests** pass (`npm test` in `frontend/`, Vitest + Testing Library),
covering secret generation and hashing, delay/expiry helpers, transfer filtering and
ordering, wallet-connection error messages, the toast context, the route table and the
primary button styles.

### Design tokens

The UI is built on three tokens defined in `frontend/src/index.css`:

| Token | Value | Use |
|---|---|---|
| `navy` | `#0A0F1E` | page, panel and card background |
| `silver-blue` | `#8FA3C7` | secondary text, borders, info and pending states |
| `copper` | `#E8743B` | accent, primary buttons, warnings and errors |

### Screenshots

Screenshots are expected at the following paths (to be added):

![Home](docs/screenshots/home.png)

![Dashboard](docs/screenshots/dashboard.png)

![Send](docs/screenshots/send.png)

![Transfers](docs/screenshots/transfers.png)

### Demo video

A demo video link is to be added here.

## Deployment

The workflow below uses a Foundry **keystore account**, so no private key is ever
passed on the command line or written to a file.

```bash
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge install foundry-rs/forge-std --no-git
forge build

# 1. Import the deployer key into the local encrypted keystore.
#    Prompts for a password and stores the key encrypted under ~/.foundry/keystores.
cast wallet import sepolia-deployer --interactive

# 2. Deploy using the keystore account.
forge create contracts/SafeRevertVault.sol:SafeRevertVault \
  --rpc-url sepolia \
  --account sepolia-deployer \
  --broadcast \
  --gas-limit 6000000
```

`--rpc-url sepolia` uses the alias from `foundry.toml`, which resolves to
`${SEPOLIA_RPC_URL}`.

### Current deployment

| Field | Value |
|---|---|
| Network | Sepolia |
| Contract | `0xa5BE6206b4EC89bdecd2Abb792dcF2eCCe0Da579` ([etherscan](https://sepolia.etherscan.io/address/0xa5BE6206b4EC89bdecd2Abb792dcF2eCCe0Da579)) |
| Tx hash | `0x65244ff54548dcd7f2e8087be69a0c7f89977ce7ca2d4ac140d4fba58dd02378` |
| Block | 12102173 |
| Verification | pending |

### A note on gas

The real deployment on Sepolia used about **5.4 million gas**, far more than the
roughly **0.8 million** the local estimate produced. `forge script` with that
estimated gas ran out of gas while storing the contract code, so the deployment was
repeated manually with `--gas-limit 6000000`, which succeeded.

### Environment variables

`.env.example` contains only the *names* of the variables that have to be filled in:

```
SEPOLIA_RPC_URL=
ETHERSCAN_API_KEY=
```

No private key is ever stored in `.env` — the deployer key lives in the encrypted
Foundry keystore, and `.env` is only used for the RPC URL and the block-explorer
API key.

## Validation summary

- **113 tests pass**: 50 unit + 13 boundary (`vm.warp` edge instants) + 9 input validation
  + 6 secret-encoding + 1 lifecycle fuzz + 10 fuzz (×256 runs) + 15 attack (reentrancy,
  front-run, double claim/cancel, ERC-777 hook) + 8 gas benchmarks + 1 invariant suite
  (64 runs, 1280 handler calls, 0 reverts).
- **62 frontend tests pass** (`npm test` in `frontend/`).
- **Coverage** (`forge coverage --report summary`): `contracts/SafeRevertVault.sol` —
  100.00% lines (61/61), statements (89/89), branches (28/28), functions (7/7).
- **Slither** (`slither . --filter-paths "lib|test"`): **0 high, 0 medium**, 5 low (all
  `timestamp`, inherent to time-locks), 1 informational (`.call` payout). CI runs the
  same command with `--fail-medium`, so the build fails only on medium or high
  findings; the accepted low and informational findings do not fail CI.
- **Tests:** `forge test -vvv` · **Gas:** `forge test --gas-report` · **CI:** `.github/workflows/test.yml`
- Deployed size: **3,330 bytes** (under the 24,576 runtime limit).

## Bugs found during testing

Four bugs were found while building and testing the project — two in the contract, two
in the dApp.

1. **`expiry` truncated from `uint256` to `uint64` (contract).** `createTransfer`
   validated `expiry` as a `uint256` but stored it with an unchecked `uint64(expiry)`
   cast. An expiry above `2^64` passed validation and wrapped around, so the stored
   expiry was tiny: `refund` became possible immediately while `claim` was impossible
   — the time-lock was silently bypassed. **Fixed** by rejecting
   `expiry > type(uint64).max` with `InvalidExpiry`. Proving test:
   `SafeRevertVaultValidationTest::test_expiryAboveUint64Max_reverts`
   (plus `test_expiryAtUint64Max_accepted` for the boundary).
2. **`recipient == address(this)` accepted (contract).** Naming the vault itself as
   the recipient created a transfer that only the vault could claim, and the vault
   never calls itself — the funds were locked until expiry. **Fixed** by rejecting the
   vault address with `InvalidRecipient`. Proving test:
   `SafeRevertVaultValidationTest::test_vaultItselfAsRecipient_reverts`.
3. **Infinite toast loop after a successful transaction (dApp).** A successful
   transaction kept re-triggering its success toast, so the toast list grew without
   bound. **Fixed** with once-per-transaction guards (toasts are keyed by transaction
   hash and deduplicated) and a stable, memoized toast context value so consumers do
   not re-render in a loop.
4. **The zero-hash checkbox stayed checked between transfers (dApp).** After creating
   a transfer with "Disable Secret (Zero Hash)" selected, the option was still
   selected on the next transfer. **Fixed** by resetting the flag in the form reset
   (and after a successful creation).

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
- **Zero-hash (secret check disabled) removes the second layer of protection:** with
  `secretHash == bytes32(0)` anyone holding the recipient's key can claim once the
  transfer unlocks, with no secret to present. The UI hides this behind "Advanced
  Option" and shows a warning when it is selected.
- **Cancelling is also available to a dishonest sender:** SafeRevert is not suitable
  for seller/buyer payments where the recipient must be able to rely on the funds
  before the unlock — the sender can cancel until the last moment.
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
- **Lost keys:** before unlock the sender can always cancel. After unlock, if the
  recipient loses their key or never claims, the sender must wait until expiry and
  then call `refund` (only the sender can). Choose `expiry` carefully.
- **No upgrade path:** logic and storage are fixed at deployment. A bug fix means
  a new deployment and migrating open transfers (which the vault does not support).
- **Event-order lint:** `reentrancy-events` (event emitted after external call) is
  intentionally kept — the state transition already happened before the payout, so
  a failed payout reverts the whole transaction including the event. Off-chain
  indexers will always see events only for successful payouts.

See [SECURITY.md](SECURITY.md) for the full report, including the contract bugs found
during testing and their fixes.
