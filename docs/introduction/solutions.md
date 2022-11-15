# Solutions

Let’s take a run through the spec we [defined earlier](../).

## Engaging with the mechanism needs a simple user experience.

Users can engage in the malt mechanism by either: 1. Bonding LP tokens 2. Pledging DAI to an auction

There is no additional complexity of multiple coins or additional actions required. Users can choose to come back and compound their rewards or withdraw the LP rewards or redeemed auction rewards but nothing more is mandatory to take part.

## Malt will require a strong incentive to buy under peg and also avoid edging out humans who can’t compete with bots \(as in the redemption of coupons in ESD\).

All auction participation creates buying pressure as all bids will buy malt behind the scenes. The auction allows the market to decide on the risk premium for holding the arb tokens by letting the auction price fall. The larger the premium the more profit the participants make for taking the risk of holding the tokens. The risk of 100% capital loss is significantly reduced due to the tokens never expiring.

If the price remains under peg the protocol will continue to contract the supply and increase it’s reserve ratio to find the supply/demand equilibrium \(the exact mechanism for this will be elaborated on more later\). Once that equilibrium is found the price should return to peg and tokens can start to be cleared. Because the supply is always contracting under peg and the arb tokens do not expire there is little incentive to suppress the price.

Even if the price is suppressed due to natural lack of demand the tokens don’t expire and therefore have less risk of 100% capital loss. As soon as the supply/demand equilibrium is found again \(regardless of how long that takes\) the arb tokens can start to be cleared again.

## It needs to achieve this incentive without punishing the loyal users of Malt.

The incentive of an explicit auction does not punish sellers \(which could just be loyal users of Malt as a stablecoin\). Instead it is just an explicit incentive for investors to speculate and thus provide the protocol the additional liquidity it requires to contract the supply while also increasing its own stabilizer liquidity.

## It also needs to ensure supply contraction under peg despite any incentives given to buyers.

The exact mechanism that allows this is at the core of Malt’s under peg system and will be explained in detail. The short version is the stabilizer will use some of the capital it controls to subsidize all auction pledges. This subsidy + the auction pledge will buy and burn at least enough malt to cover the premium \(often it will burn even more than that\).

This ensures that the worst case is a net neutral supply change when factoring in the premium that needs to be paid and in the best case provides a real meaningful burn of supply even after all auction participants have been rewarded.

This solves the problem that ESD/DSD have with the premium creating a short term contraction of supply but ultimately requiring ever increasing supply growth to maintain peg.

This is also the reason why the Arb tokens do not need to expire. ESD/DSD coupons expired as a way of ensuring real supply contraction in cases where price couldn’t reach peg for sustained periods. The fact that Malt has a guaranteed supply contraction obviates the need for expiring coupons and thus massively reduces the risk to speculators participating in the auction mechanism.

## The mechanism must be able to kick in fast and the cycle time must be short.

Expansions and auctions are triggered by the stabilizer and can come into effect as soon as the price moves 1% away from peg. This mechanism does not require the rollover of epochs before anything can happen. This allows the mechanisms to kick in almost instantaneously.

Above peg the stabilizer will mint and sell Malt as soon as the price triggers above peg. This provides immediate sell pressure to bring price down.

Below peg all participation in the auction creates buying pressure. When an auction starts it computes how much buying pressure is required to return to peg. That value becomes the target amount of pledges for that auction. That means if an auction is fully subscribed the price should be back at peg.

This in effect means that it is possible for the full cycle of price falling below peg, triggering an auction and getting back to peg could last only a matter of minutes from start to finish.

## It also must not add additional risk to those engaging under peg \(like the risk of 100% capital loss from expiring coupons\).

This has already been mentioned but the arb tokens acquired via auction participation do not expire. This drastically reduces unnecessary risk in participating in the mechanism. Of course, all the normal risks still apply.

However, the protocol will try to weather periods of low demand by increasing its stabilizer capital and reducing total supply of Malt. In doing so there is a kind of price discovery process for total supply where it is searching for the supply/demand equilibrium that would leave Malt naturally priced at $1.

Whenever it finds that equilibrium the protocol can start working away at redeeming outstanding tokens. The oldest auctions will be redeemed first.

In coins like ESD this supply discovery phase in some ways necessitates letting some coupons expire to have a meaningful burn of supply and release stress on the next expansion. Malt does not have this problem due to the previously mentioned usage of stabilizer liquidity to burn more supply to realise a meaningful supply reduction.

## The distribution of tokens must try to skew towards buying pressure in the early stages of the protocol to give the protocol time to find a solid footing.

There is no presale or seed round for Malt. There is a small community offering to raise initial funds for liquidity. This will be around 100k Malt and all the Malt sold via this will be sold at $1 per MALT ie zero discount. Apart from this the only way for anyone to acquire Malt will be to buy it on the dex. This means initially there is no one with Malt to dump and only people wanting to buy it. This process gives the protocol some time to find it’s footing before early speculators try to leave \(and therefore sell\).

Additionally, because farming rewards and auction redemptions are paid in DAI there is a reduction in how much Malt any individual can accumulate. The only way to accumulate large amounts of Malt is to buy it all. This will significantly reduce the need for “whales” to dump large amounts of Malt they earned via farming.

The small amount of initial liquidity on the DEX does mean price slippage will be high initially. The slippage will move the price upwards which will immediately trigger the stabilizer to bring the price back to peg. Early users are warned against “chasing the pump” as they will get burned very quickly when the stabilizer steps in and corrects the price.

