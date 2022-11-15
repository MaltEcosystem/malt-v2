# Terminology

Here is a quick overview of some common terms used in the Malt system. These are all elaborated on in more detail further into the docs.

- **Algorithmic Stablecoin**: A coin that attempts to hold a stable value using predefined and automatic algorithmic rules rather than human decision making.
- **Implied Collateral**: Malt's innovative capital efficient collateral system.
- **Arbitrage Auction**: An auction to allow the market to price the risk on Malt recovering peg when it falls below $1 per Malt.
- **Liquidity Extension**: A store of capital that is used during Arbitrage Auctions to ensure sufficient Malt is burned from the supply to offset the risk premium on the Arb Tokens.
- **Swing Trader**: The protocol's very own arb bot. It is a gigawhale that is always ready to buy Malt and will aggressively try to profit on the trades.
- **Stabilizer Pod**: A group of contracts that are in charge of keeping a particular AMM pool stable and distribute rewards to LPs of that pool.
- **Stabilizer Node**: The brains of the stabilization system. This is the contract in charge of making supply adjustment decisions.
- **Recovery Mode**: The state a Stabilizer Pod goes into when the pool falls below peg. In this mode buying on the AMM is restricted to funnel capital through the Arbitrage Auctions.
- **Focal Vesting**: The scheme Malt uses for vesting. Instead of a fixed vesting period there are instead fixed "Focal Points" and all rewards in a given period vest towards that single focal point. This means vesting on rewards can be anywhere between 24-48 hours.
- **Reinvestoor**: That's you, fren
