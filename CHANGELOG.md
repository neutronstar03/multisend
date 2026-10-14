# Changelog

## 1.0.1

- Default to the verified Ethereum deployment, including browsers with a previously empty contract setting.
- Explain why batch simulation is unavailable, including missing token approvals.
- Allow the next approval after wallet submission while earlier approvals await their own transaction receipts. Show each pending approval and transaction link independently.
- Correct Foundry deployment estimation syntax and expose optional EIP-1559 fee overrides.

## 1.0.0

- Initial zero-fee atomic ERC-20 multisender and static mainnet frontend.
- Indexed and manual token discovery, unlimited or exact approvals, full-precision amounts, simulation and exact runtime verification.
