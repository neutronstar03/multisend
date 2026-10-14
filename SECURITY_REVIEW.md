# Pre-deployment review

Date: 2026-10-14. Status: contract not deployed onchain; source verification pending deployment.

## Reviewed contract identity

- Source: `contracts/MultiSend.sol`, Git blob `3a9a23a72d3b8195040d284de4a05d1f1d06c7b7`.
- Compiler: Solidity 0.8.28; optimizer 1,000,000 runs; EVM Cancun; no CBOR metadata or bytecode metadata hash.
- Creation-code hash: `0x1c85b1d9b63f59ddb76af718bfb44f25840da15bce1f04ac62510cea95e71dcb`.
- Runtime hash: `0x97c7d3a3d328b5abda4bacc540309191f1ecaa35647b2bb42d7ddbc889d7e3a2`.
- CREATE2 factory: `0x4e59b44847b379578588920cA78FbF26c0B4956C`.
- Salt: `keccak256("ns03.multisend.v0.1.0")`.
- Predicted address: `0x6dd1CFbea062D4a6843BbbEA16912b76d585BA94`. Prediction is not proof of deployment.

## Three verification passes

1. Implementation and adversarial tests: 33 isolated Solidity tests passed, including 256 runs each for two fuzz tests. They cover unauthorized caller isolation, swallowed reentrancy, atomic rollback, false/no-return/noncanonical/oversized ERC-20 return data, invalid recipient, EOA token and batch-size validation.
2. Independent agent review: read-only source and artifact inspection confirmed msg.sender is always the token owner, no admin/upgrade/arbitrary-call path exists, and regenerated creation and runtime bytecode match the exported artifact. This is automated independent review, not a professional third-party audit. Initial integration gaps (missing discovery during implementation and placeholder artifact) were subsequently completed; artifact generation is now part of every production build.
3. Mainnet fork: executed the real deterministic factory deployment and a batch of 17 held catalogue assets after simulated approvals, checking sender balances, recipient increases and absence of custody. The actual integration run set `MULTISEND_TEST_WALLET`; ordinary tests without that variable do not exercise the fork. No mainnet transactions were broadcast. Separate CLI preflight verified factory runtime and simulated creation on mainnet.

Frontend checks: 36 Bun tests, TypeScript typecheck, ESLint and production build pass. Discovery tests cover pagination, partial enumeration, malformed upstream data, bytes32 metadata, dust, allowances and repeated-page guards.

## Findings resolved

- Reject sending to the multisender itself, to avoid accidental unrecoverable token custody.
- Require canonical bool return data when a token returns a value, while supporting legacy no-return transfers.
- Validate artifacts before use, export fresh artifacts during build, and compare configured onchain runtime hash.
- Recheck wallet account and chain before requests; invalidate reviewed batches when amounts or recipient change.
- Qualify transfer amounts for fee/rebase tokens and compare observed recipient balance changes after a confirmed transaction. This is an observation across blocks, not a trace of this transaction alone; concurrent transfers or rebases can affect it.
- Surface failed token reads and incomplete indexed scans; never hide positive balances for lack of a market price.
- Keep deployment entirely outside the web frontend and use a separate CLI keystore.

## Accepted limits

- A malicious or nonstandard token can claim transfer success without moving funds. The multisender checks the token call result, not arbitrary-token economic semantics. Fee-on-transfer tokens can deliver less; rebases can alter balances. The post-receipt observation detects differences when measurable and does not guarantee exact delivery before signing.
- Low-level calls copy token returndata; a deliberately pathological token can exhaust gas and revert the whole selected batch. It cannot spend another user's approval through this contract.
- The frontend rejects self-to-sender transfers for usability; the contract permits them. Duplicate tokens are permitted by the contract but rejected by the frontend.
- Unlimited allowance is the user's selected default. No caller can spend another owner's allowance through batchTransfer; compromised signing UI or token implementation remains outside this invariant.
- The browser bundle is not an independent trust anchor. Verify the published source/build hashes and explorer source separately. Custom RPC and indexer integrity are outside the contract review.
- AirGap QR signing has not yet been exercised end-to-end with this app. The app uses standard ERC-20 approvals and contract calls; it does not use EIP-7702 or special signer messages.
- Cross-chain address stability requires identical factory, salt and initcode plus EVM opcode compatibility. The UI currently supports Ethereum mainnet only.

## Remaining deployment steps

Use `scripts/deploy.ps1` with the separate deployer keystore; inspect its preflight before adding `-Broadcast`. Verify source on Etherscan, compare deployed runtime, record deployment address/transaction, then configure the frontend. No deployer has privileges after creation.
