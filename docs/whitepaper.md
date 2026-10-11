# HOOQ Whitepaper

## 1. Vision and mission

**Vision.** Liquidity that behaves the way its builders decide, on a base layer everyone can inspect.

**Mission.** Give every market on Solana the same compact core and six open sockets, so custom logic plugs in around swaps, deposits, withdrawals and fees without anyone rebuilding the pool.

HOOQ treats the website as part of the product. Facts that are not confirmed are shown as empty slots marked `pending` instead of being guessed, and market figures on the page are computed in the visitor's browser from public data.

## 2. How a pool works

1. A market maker packs liquidity into tight price bands around the active price.
2. Six sockets surround each market: order check, settlement, fee, deposit, withdrawal and price feed.
3. Modules wire into any of those sockets. A wired module runs at its point in the swap, deposit or withdrawal path.
4. Modules cooperate inside one market, and a market with nothing wired behaves like a plain pool.

Example modules shown on the site:

| Module | Socket | Purpose |
|---|---|---|
| Opening cap | order check | Restricts early trading volume right after launch |
| Adaptive fee | fee | Moves fees with recent price swings |
| Price log | price feed | Records a rolling price average other programs may query |
| Maker share | settlement | Routes a slice of swap fees to the pool creator |

Parameters for every module are pending until confirmed.

## 3. The live pulse

The site also tracks busy boosted tokens on Solana:

1. Request the boosted token list from the market source.
2. Keep only Solana entries and collapse repeated addresses.
3. Request trading pairs for those addresses in groups of thirty.
4. Add volume and depth across the pairs of each token, and take price and daily move from the deepest pair.
5. Rank by day volume and show the top ten.

The pulse refreshes every minute, pauses while the tab is hidden and fetches at once when the tab returns. On failure it backs off exponentially and keeps the last good rows on screen. It never depends on the contract address.

## 4. Tokenomics

All values below are placeholders until stated.

| Item | Value |
|---|---|
| Chain | Solana |
| Contract address | pending |
| Supply | pending |
| Fees | pending |
| Liquidity lock | pending |
| Audit | pending |

## 5. Roadmap

**Phase 1: Signal.** Live board, ticker and dials go public and stay open for everyone.

**Phase 2: Contract.** The contract address is announced once and pinned at the top of every page.

**Phase 3: Liquidity.** Pool details and lock terms are published with verifiable proof beside them.

**Phase 4: Community.** Public channels open and the source code is released for inspection.

## 6. Team

| Role | Name |
|---|---|
| Lead | pending |
| Engineering | pending |
| Community | pending |

## 7. Disclaimer

HOOQ shows public market data for information only. Nothing here is financial advice, and market figures can be wrong, delayed or manipulated.
