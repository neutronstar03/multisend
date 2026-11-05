# Changelog

## 1.1.0

- Restore the chosen, already-authorized wallet silently and refresh current balances; explicit Disconnect disables automatic restoration.
- Persist public approval tracking metadata across reloads and reconcile receipts, allowances, known replacements and cancellations without automatic signing.
- Show and manage saved manual token addresses, with contract validation, zero-balance feedback and catalogue/indexer origin labels.
- Prepare batches using named token groups and destinations, preserving legacy preferences and custom amounts with explicit Max and full-address review.
- Solidity contracts, bytecode, runtime hash and deployment address remain unchanged.

## 1.0.1

- Default to the verified Ethereum deployment, including browsers with a previously empty contract setting.
- Explain why batch simulation is unavailable, including missing token approvals.
- Allow the next approval after wallet submission while earlier approvals await their own transaction receipts. Show each pending approval and transaction link independently.
- Correct Foundry deployment estimation syntax and expose optional EIP-1559 fee overrides.

## 1.0.0

- Initial zero-fee atomic ERC-20 multisender and static mainnet frontend.
- Indexed and manual token discovery, unlimited or exact approvals, full-precision amounts, simulation and exact runtime verification.
