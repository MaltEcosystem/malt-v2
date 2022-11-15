# Liquidity Extension

Liquidity Extension is a source of capital that has only one purpose - ensure that Arbitrage Auctions never result in a growth in supply.

The problem arises because there is a difference between the pricing of the Arbitrage Tokens and the pricing of Malt on the AMM during the auction.

Imagine Arbitrage Auctions without liquidity extension.

1. $10 pledged to an auction that finished at a arb token price of $0.50 - 20 Arbitrage Tokens purchased. The Malt AMM price at the time of the pledge was $0.80.
2. The $0.80 market price of Malt means that the $10 pledge purchased and burned 12.5 Malt.
3. Arbitrage Tokens are paid off using the same stream of income that pays LPs above peg (minting and selling new Malt). Every Arb Token is redeemable for $1 so we can assume that to pay back 20 Arb Tokens you must mint and sell 20 Malt.
4. Malt lost peg due to excess in the supply of Malt. So we needed to contract the supply. We managed to do that when we burned 12.5 Malt during the Arb Auction. Problem is that to pay back the premium we now need to Mint 20 Malt.
5. Net supply change was +7.5 Malt. In the processes of trying to recover peg we increased the supply of Malt.

This is the problem that many previous stablecoins with similar "debt" mechanisms failed. They didn't realise that their mechanism was forcibly expanding the supply despite their claims it was decreasing it. This obviously leads to a massive drop in price as the supply continues to expand. Eventually reaching a point where it is impossible to recover.

#### So where does Liquidity Extension come in?
The purpose of liquidity extension is to burn those additional 7.5 Malt during the auction (or maybe even more if it chooses to) so that the supply is at a minimum unchanged after the arb tokens have been paid back.

There are various parameters involved here that all interrelate. For example the amount of liquidity extension determines the minimum price of the auction. This is calculated as the minimum price where the liquidity extension can still sustainably cover the difference between the market price and the auction price.

Ultimately it is all revolving around the idea that the auction should, under no circumstances, lead to an increase in the supply. Liquidity extension is the missing piece of that puzzle.

If you are interested in a more technical description of how this function it will be explained in the technical section for those who are interested.
