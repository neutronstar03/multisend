# Multisend

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User confirmed static TypeScript/Vite. No backend. Cloudflare hosting at multisend.ns03.dev.

## Users

An experienced Ethereum user moving 10-25 different ERC-20 assets to one address, signing in Rabby or MetaMask with AirGap Vault over QR.

## Product Purpose

Discover balances including unpriced tokens and vault shares, approve a simple multisender once, then transfer selected amounts in one atomic transaction without a service fee.

## Operating Context

Public frontend, settings kept in the browser. Mainnet first. The signer must retain the private keys. No seed import. A missing price never hides a balance. Manual token entry complements indexed discovery.

## Capabilities and Constraints

Standard ERC-20 approvals; unlimited approvals selected by default at the user's request, with exact-amount choice. User signs every transfer and approval. Contract deployment uses Foundry CLI and a separate deployer wallet, never the web frontend or the user's cold wallet. No automatic fallback to individual token sends. Tokens with restricted transfers such as rEUL must fail simulation and be excluded by the user. Contract must be tested, independently reviewed, and verified on Etherscan before normal use.

## Brand Commitments

User requested a dark, compact operational screen; public site; no marketing landing page.

## Evidence on Hand

The inspected wallet has priced tokens, unpriced assets, dust, vault shares and unsolicited tokens. Never infer market value from token symbol, raw balance or a missing price.
