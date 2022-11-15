# Unbonding Forfeit

Due to the vesting system in place that uses the Focal Vesting concept a bonded LP always has some amount of rewards that are "still to vest". If the LP stays bonded until the end of the next focal period they will have vested all of those rewards (but probably also earned more in the interim and still has some amount "still to vest").

If the LP unbonds they forfeit their "still to vest" pro-rata the share of their total bonded LP they are removing. IE if you unbond 50% of your bonded LP then you will forfeit 50% of the still to vest amount at that point.

The forfeited funds are split between going to the Malt Treasury and the Swing Trader to increase implied collateral.

#### Bank Run protection
This system has the power to provide some insurance against a bank run.

When the price of Malt drops below peg and panic encircles the market then many bonded LPs may make the choice to unbond and sell their Malt so they don't get caught holding the bag.

However, when they do that they forfeit some of their rewards to the Swing Trader which will then be used to buy back some of the Malt they sell.

This process of the implied collateral increasing while users are unbonding we hope can act as a "storm defence" that will be able to stave off bank runs that may otherwise kill a weaker coin.
