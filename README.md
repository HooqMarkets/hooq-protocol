# HOOQ

**Programmable liquidity pools on Solana.**

[![Live site](https://img.shields.io/badge/live-hooq.markets-black?style=flat-square)](https://hooq.markets)
![Chain](https://img.shields.io/badge/chain-Solana-black?style=flat-square)

| | |
|---|---|
| Chain | Solana |
| Contract address | `pending` |
| Site | [hooq.markets](https://hooq.markets) |

## Overview

HOOQ is an automated market maker for Solana that packs liquidity into tight price bands and leaves six sockets open around every market. Builders wire modules into those sockets, such as opening caps, adaptive fees, rolling price logs and maker shares, so each market behaves the way its creator decided without rebuilding the pool underneath.

This repository holds the public site. Beside the product story, the page carries a live pulse of busy boosted Solana tokens, ranked by day volume.

The contract address is announced separately. Until it is stated, its slot at the top of the page stays inert and reads `pending`. The live pulse never depends on it.

## Features

- Six sockets per market, drawn as an interactive rack in the hero
- Module cards with empty slots that fill once settings are confirmed
- Live ranked table of ten Solana tokens, refreshed every minute and paused while the tab is hidden
- Ticker strip, volume curve, gauges, spotlight card and depth filter fed by the same data
- Skeleton loaders, count-up numbers and a flash on every value change
- Calm failure handling: exponential backoff, a dash with an error line, and the last good rows kept on screen
- Scroll reveal on a damped spring, hero parallax, spotlight hover and a scroll progress bar
- Full `prefers-reduced-motion` fallback
- Register-driven facts: every external fact is one record with a state of `stated`, `absent` or `unconfirmed`, and anything not stated renders inert
- Palette measured from the logo pixels; colour literals live in one tokens file

## Links

- Website: [hooq.markets](https://hooq.markets)
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Development

```bash
npm run build   # writes the deployable site to dist/
npm run gates   # builds both branches of every gate and checks them
```

`dist/` is the folder to publish. No dependencies are required.

## License

MIT. See [LICENSE](LICENSE).
