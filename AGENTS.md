# Multisend operator instructions

- Use Bun and the lockfile; this is a static TypeScript/Vite app, no backend or SSR.
- Mainnet only. Never silently downgrade a batch to per-token sends.
- Keep unpriced tokens and dust discoverable. Indexer completeness must be honest.
- Never commit credentials or user-specific wallet addresses.
- Maintain the invariant that token source is msg.sender. No arbitrary-call functionality, owner, fees or upgrades.
- Run forge test, forge fmt --check, bun test src, bun run typecheck, bun run lint and bun run build before shipping.
- Export artifacts with bun run artifacts after contract changes. Frontend runtime verification binds to this exact build.
- Contract deployment uses Foundry CLI and a separate deployer wallet; never expose web deployment. Review independently and verify source on Etherscan before recommending approvals.
- No worktrees without explicit request.
