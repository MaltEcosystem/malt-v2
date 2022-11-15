# Recover Mode

Recovery Mode is a mode of operation that Malt goes into when the short length TWAP drops below the $1 peg price.

When the price drops below peg it is a symptom of an imbalance in supply/demand for Malt. Waiting for the market to naturally sort out that imbalance can take a long time. So Malt goes into recovery mode which changes the way Malt functions temporarily to speed up the balancing of supply/demand and hopefully speed up peg recovery.

**The core change in Recovery Mode is that AMM purchasing of Malt is turned off**

Selling is unaffected.

Wait? Didn't we say that to recover peg you need to encourage buying? Why are we now completely stopping it?

This seems counter-intuitive on the surface but stay with us.

For a start, **the Swing Trader is still allowed to buy.** But the Swing Trader is clever. It won't just start buying as soon as recovery mode starts. Instead, it will patiently wait and let everyone who wants to sell go ahead and sell. Once the selling has slowed down the price is at the lowest point it has been (remember no buying, so price can only go down until Swing Trader steps in).

Now the Swing Trader gets exclusive access to buy at this amazing price. Pretty good situation for a gigawhale like the Swing Trader.

Turning off the buying on AMM also encourages speculators to use the protocol's Arbitrage Auction to speculate on price instead of buying the underlying. Either that or they sit on the sidelines.

By turning off buying we can let the supply imbalance work itself out quickly by letting everyone who wants to sell to just sell. Then the Swing Trader buys all of that supply back to return price to peg. By removing that supply from the market the Swing Trader has quickly taken action to reinstate the supply/demand imbalance.

If the Swing Trader can't reinstate the peg during recovery mode then Malt will work it's way through the other sources of implied collateral then finally it will have public Arbitrage Auctions to let the community help defend the peg.

An additional point worth making is to go back to our values - we want everything to be fair. 

If we didn't block buying it would be possible for the bots to extract value from Malt - and therefore from LPs by sandwiching the swing trader. So we needed to avoid that from happening. But as we found out this allows for other additional benefits.
