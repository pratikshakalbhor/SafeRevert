# SafeRevert Frontend

A high-security, time-locked transfer escrow frontend interface for `SafeRevertVault` on Ethereum Sepolia testnet.

Built with **React 19**, **TypeScript**, **Vite**, **wagmi v2 / v3**, **viem**, **RainbowKit**, **Tailwind CSS v4**, and **Vitest**.

---

## Architecture & Layout

```
frontend/
├── src/
│   ├── components/
│   │   ├── Navbar.tsx             # Responsive header with navigation tabs & RainbowKit connect
│   │   ├── NetworkBanner.tsx      # Wrong-network warning & 1-click switch to Sepolia
│   │   ├── ToastContext.tsx       # Toast provider rendering transaction links & toasts
│   │   └── ToastTypes.ts          # Toast interface definitions & React context
│   ├── hooks/
│   │   ├── useToast.ts            # Toast notification hook
│   │   ├── useTokenInfo.ts        # ERC-20 symbol, decimals, balance & allowance loader
│   │   └── useTransfers.ts        # Reads nextId()/getTransfer() and filters the user's transfers
│   ├── lib/
│   │   ├── abi.ts                 # SafeRevertVault & standard ERC-20 compiled ABIs
│   │   ├── config.ts              # Sepolia chain, Wagmi config & environment variables
│   │   ├── crypto.ts              # 32-byte secret generator, viem keccak256 hash & pre-check
│   │   ├── crypto.test.ts         # Vitest unit tests for cryptographic functions
│   │   ├── errors.ts              # Decodes custom errors (TooEarly, Expired, InvalidSecret, etc.)
│   │   ├── transferFilter.ts      # Pure filter/sort of a user's transfers (sender or recipient)
│   │   ├── transferFilter.test.ts # Vitest unit tests for transfer filtering & ordering
│   │   ├── time.ts                # Timelock delays, absolute expiry, formatting & countdowns
│   │   ├── time.test.ts           # Vitest unit tests for timelock logic
│   │   └── types.ts               # TransferRecord, TransferState and Token types
│   ├── pages/
│   │   ├── SendPage.tsx           # Escrow creation, ERC-20 approve flow, one-time secret modal
│   │   ├── TransfersPage.tsx      # Filterable transfer list with live countdowns & actions
│   │   └── ClaimPage.tsx          # Direct claim form with secret pre-validation
│   ├── App.tsx                    # Top-level routing, query parameter sync, providers
│   ├── main.tsx                   # React root entry point
│   └── index.css                  # Tailwind CSS & RainbowKit styles
├── .env.example                   # Example environment configuration
├── .oxlintrc.json                 # Linter configuration (0 warnings, 0 errors)
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Setup & Running

### 1. Requirements
- Node.js >= 20.0.0
- npm >= 10.0.0

### 2. Install Dependencies
```bash
cd frontend
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Update values in `.env`:
- `VITE_VAULT_ADDRESS`: The deployed address of `SafeRevertVault` on Sepolia.
- `VITE_DEPLOY_BLOCK`: **Optional and no longer used** — kept only for backwards compatibility. The app no longer queries `TransferCreated` logs, so no deploy block is needed.
- `VITE_SEPOLIA_RPC_URL`: Sepolia RPC endpoint (e.g. `https://rpc.sepolia.org` or Alchemy/Infura).
- `VITE_WALLETCONNECT_PROJECT_ID`: Your Reown / WalletConnect Project ID.

### 4. Run Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### 5. Run Unit Tests
```bash
npm test
```
Runs 26 unit tests in Vitest covering secret generation, Solidity-compatible keccak256 secret hashing, delay validation, expiry calculation, wallet connection error messages, and transfer filtering/sorting.

### 6. Build & Typecheck
```bash
npm run build
npm run lint
```

---

## Security Guarantees & Features

1. **No Secret Storage**:
   - The generated 32-byte secret is never stored in `localStorage`, `sessionStorage`, cookies, analytics, or URL query parameters.
   - It resides purely in component memory and is displayed **once** after transfer creation. Once the user copies it and clicks "I am Done", it is wiped from memory.
2. **Pre-Flight Secret Hash Check**:
   - On the Claim page, the client computes `keccak256(toBytes(secret))` and compares it against the on-chain `secretHash` before sending any transaction.
   - If there is a mismatch, the user is warned and the Claim button remains disabled, preventing failed on-chain transactions and wasted gas.
3. **Direct Contract Reads**:
   - Reads `nextId()` and then the newest 200 transfers via `getTransfer(id)` (multicall in batches of 50, plain `eth_call` fallback in batches of 20), then keeps only the entries where the connected account is the sender or recipient, sorted newest first.
   - No `eth_getLogs` is used, so strict free-tier RPC log-range limits (e.g. 10 blocks) cannot break the page.
4. **Decoded Custom Contract Errors**:
   - Decodes `InvalidRecipient`, `InvalidAmount`, `InvalidDelay`, `InvalidExpiry`, `MsgValueMismatch`, `TransferNotFound`, `NotPending`, `NotSender`, `NotRecipient`, `TooEarly`, `Expired`, `InvalidSecret`, `EthTransferFailed`, and `SafeERC20FailedOperation`.
5. **Wrong-Network Guard**:
   - Displays a prominent banner with a one-click button to switch network to Sepolia whenever an unsupported network is connected.

---

## 6 Screens to Record for Demo Video

1. **Screen 1 — Connect & Send Setup**:
   - Connect wallet on Sepolia. Fill out the Send form with a recipient address, select ETH or ERC-20 token, enter amount, choose a 15-minute delay and 24-hour expiry window.
   - Highlight the live local timestamp preview of Unlock Time and Expiry Time, and the in-memory 32-byte secret generator with commitment hash.
2. **Screen 2 — Review & Approve / Create Confirmation**:
   - Click "Review & Confirm Transfer" to show the verification modal with full recipient address, token amount, local timelock timestamps, and commitment hash.
   - For ERC-20, show the 2-step approval button followed by transaction creation.
3. **Screen 3 — One-Time Secret Revelation Modal**:
   - After transaction confirmation, show the dedicated success modal displaying the new Transfer ID and the one-time secret string.
   - Demonstrate the "Copy Secret" button and the mandatory confirmation checkbox before clearing the secret from memory.
4. **Screen 4 — My Transfers (Sender View & Cancel Action)**:
   - Navigate to "My Transfers". Show outgoing transfers with status badges and live countdown to unlock.
   - Demonstrate that the "Cancel & Reclaim Funds" button is enabled before unlock, and show the countdown. Click cancel to demonstrate the refund flow.
5. **Screen 5 — Claim Page with Secret Verification**:
   - Switch wallet to the designated recipient address. Enter or link the Transfer ID.
   - Show the transfer details, recipient match indicator, and active claim window.
   - Type an incorrect secret to demonstrate the red warning badge ("❌ Secret does not match on-chain hash! Prevents wasted gas").
   - Paste the valid secret to show the green checkmark ("✅ Secret verified!").
6. **Screen 6 — Claim Execution & Terminal State**:
   - Click "Claim & Payout Funds", confirm transaction in wallet, and show the success toast with Sepolia Etherscan link.
   - Show the updated status ("Claimed") and terminal state handling. Also show wrong-network switch banner by changing wallet network.
