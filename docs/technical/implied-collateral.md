# Implied Collateral

Implied collateral is the term used to describe the way Malt makes use of additional sources of capital as if they are collateral, while they are serving other purposes.

The two main sources of implied collateral are:

* AuctionPool
  * This is a pool of above peg protocol profit that is to be allocated to users as rewards. However, before users get access to this capital it must be deployed into an arbitrage auction. Once the DAI -> arb tokens -> DAI cycle has completed then the DAI is rewarded pro-rata to LPs.
* RewardOverflowPool
  * This is the pool of capital that is filled via excess rewards above the Desired Epoch APR for a given epoch. This capital's main job is to smooth out variance in rewards from epoch to epoch. So this too is capital that will eventually become user rewards. However, if required, the protocol will use this capital to purchase arb tokens to defend peg, turning the reward capital into a form of collateral.
  * Unlike AuctionPool when the arb tokens are redeemed all the profit is retained in the overflow pool, just extending the runway of reward smoothing (and size of implied collateral).
