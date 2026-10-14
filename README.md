# Multisend

Static Ethereum mainnet frontend and a minimal ERC-20 batch transfer contract. Select different tokens and send them to one recipient in one atomic transaction. No service fee.

Target: https://multisend.ns03.dev

## Run

```powershell
bun install
bun run artifacts
bun run dev
```

The frontend uses an injected EIP-6963 wallet (Rabby or MetaMask). AirGap QR signing stays within the wallet's normal transaction flow. The frontend never requests private keys. No EIP-7702 support is required.

## Workflow

1. Connect the sending wallet on Ethereum mainnet.
2. The Ethereum contract defaults to `0x6dd1CFbea062D4a6843BbbEA16912b76d585BA94`. A custom address can be saved locally; the frontend requires its runtime bytecode hash to match this build.
3. Optionally configure an Alchemy or Etherscan API key for indexed discovery. Without an indexer, the known-token catalogue and manually entered token addresses are used; completeness is explicitly not claimed.
4. Select tokens and edit amounts. All positive balances remain visible, including dust, unpriced assets and vault shares. Prices are not required or inferred.
5. Approve each token once. After the wallet submits an approval, you can approve the next token while earlier transactions confirm. Each token follows its own transaction receipt; simulation waits for confirmations. Unlimited approval is the default requested for repeated use; exact approval is available. Tokens requiring zero-first approval have a separate reset action.
6. Simulate the exact batch after approvals confirm, review the recipient and amounts, then sign the final send in the wallet.

API keys, RPC URL, contract, manual addresses and recipient are stored only in this browser. They are sent to their respective API providers when used. Wallet connection and selected amounts are not persisted. The public build contains no personal address or API key.

## Contract

`contracts/MultiSend.sol` has no owner, administrative functions, upgrades, fees or arbitrary call execution. `batchTransfer(recipient,tokens,amounts)` always uses `msg.sender` as the source of each `transferFrom`. Transfers go directly to the recipient. A caller cannot choose another token owner or spend another account's allowance.

All transfers are atomic. There is a 100-entry cap, a reentrancy lock, and safe handling of legacy ERC-20 return values. A token can lie about its behavior or apply transfer fees; successful execution cannot guarantee an exact recipient balance for arbitrary nonstandard tokens. Restricted assets such as locked rEUL may not support ordinary transfers.

## Checks before deployment

```powershell
forge fmt --check
forge test -vv
bun run artifacts
bun test src
bun run typecheck
bun run lint
bun run build
```

Do not treat a successful test suite or automated independent review as a professional external audit. Check `SECURITY_REVIEW.md` for the recorded scope and findings.

Run the optional integration test against your own current mainnet balances (read-only fork; no broadcasts):

```powershell
$env:MULTISEND_TEST_WALLET = '<wallet address>'
$env:MAINNET_RPC_URL = 'https://ethereum-rpc.publicnode.com'
forge test --match-contract MainnetForkTest -vv
```

That wallet must hold at least ten catalogue tokens. Without the wallet environment variable this optional test does not fork; the 33 isolated tests still run normally. `bun run build` regenerates contract artifacts before bundling, preventing stale artifacts from shipping after source changes.

The independently reproducible runtime hash for this contract revision is `0x97c7d3a3d328b5abda4bacc540309191f1ecaa35647b2bb42d7ddbc889d7e3a2`. Compare it with both a local Foundry build and the deployed runtime, not only the website's own bundle.

## Deploy and verify on Etherscan

Deployment is CLI-only, using a separate deployer wallet. There is no deploy button in the frontend. The deployer receives no administrative rights. Do not approve assets until source verification is confirmed.

CREATE2 uses the deterministic factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`, a versioned salt, and the exact creation bytecode. The same factory, salt and creation bytecode produce the same address on compatible EVM chains. Each chain still requires a deployment; the factory's bytecode is checked on every target chain, and no automatic factory bootstrap is attempted. Changing the bytecode changes the predicted address. Current build targets Cancun; target chains must support its opcodes.

Import the separate deployer into an encrypted Foundry keystore, or use an existing one:

```powershell
cast wallet import multisend-deployer --interactive
bun run prepare:deploy
./scripts/deploy.ps1 -Account multisend-deployer
```

Preparation and the PowerShell command above only simulate and estimate. Once reviewed, the following command signs and broadcasts the deployment transaction:

```powershell
./scripts/deploy.ps1 -Account multisend-deployer -Broadcast
```

Optional EIP-1559 fee overrides apply to both estimation and broadcast. For example (illustrative values, not a current fee recommendation):

```powershell
./scripts/deploy.ps1 -Account multisend-deployer -MaxFeeGwei 2 -PriorityFeeGwei 0.1
```

Add `-Broadcast` to submit with those same overrides. `MaxFeeGwei` caps the total price per gas, including the priority fee; it is not the gas limit. The actual charge is gas used times the effective gas price. Omit these options to let Foundry estimate fees.

For another compatible chain, supply `-RpcUrl` and `-ChainId` explicitly. Do not recompile with different settings between chains. The script checks chain ID, factory code, address occupancy, gas estimate and deployed runtime. Its `deployment-plan.json` is ignored by Git. No private key is passed in command arguments.

After obtaining the contract address, set the API key in the local environment and run:

```powershell
$env:ETHERSCAN_API_KEY = '<your key>'
forge verify-contract --chain mainnet --watch <DEPLOYED_ADDRESS> contracts/MultiSend.sol:MultiSend
```

Foundry uses the pinned compiler, optimizer and metadata settings from `foundry.toml`. Then independently compare the deployed runtime:

```powershell
cast code <DEPLOYED_ADDRESS> --rpc-url https://ethereum-rpc.publicnode.com
forge inspect MultiSend deployedBytecode
```

The two byte sequences must match exactly. Confirm Etherscan displays verified source and compiler settings, and compare `BatchTransfer` event values and recipient token balances after the first small batch. Record the deployment address and transaction only after they exist.

## Hosting

```powershell
bun run deploy:web
```

Cloudflare Pages serves `dist`. The frontend is publicly accessible and has no backend. Production contract addresses are browser settings until a verified deployment is recorded. No contract has been deployed merely by building or publishing the frontend.
