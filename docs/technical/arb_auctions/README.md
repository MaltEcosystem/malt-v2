# Arbitrage Auctions

When the 2 epoch twap for a given AMM pool drops below $0.99 anyone can trigger an auction for that AMM pool. The auction is a dutch auction over 30mins that starts at a price at or near $1 per token and linearly drops down to some minimum price. The auction ends when a predetermined amount of pledges have been reached or when the 30 minutes elapses.

Every “bid” on an auction is in the non-native token in the AMM pool and it is immediately used by the protocol to purchase and burn malt. Each bid purchases arbitrage tokens at whatever price the auction finishes at.

All purchased arb tokens are redeemable for $1 worth of the non-native token of the AMM pool in question. The redemption is carried out automatically by the protocol at the earliest possible time. The redemption is carried out pro-rata on everyone’s balance i.e. if 10% of arb tokens for a given auction are redeemed then every user has 10% of their tokens automatically redeemed.

Again, the arb tokens are paid in the non-native tokens much like LP rewards. All the benefits mentioned in the LP reward section still apply. Users will not need to sell additional native tokens to realise profits, further reducing the incentivized selling seen in other similar coins.

## Auction execution

The auction process is split into 3 distinct phases

1. Auction setup.
   * Setting up auction pricing
   * Reserve precommitment
2. Auction is active
3. Auction finalization

