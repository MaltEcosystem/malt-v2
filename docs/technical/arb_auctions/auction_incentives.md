# Auction Incentives

There are 3 distinct goals during the auction:

* Incentivize sufficient buying pressure in the market to return price to peg.
* Do so while ensuring a meaningful supply contraction
* Ensure the pod reserve ratio is dropping slower than Malt is being burned wherever possible.

A pitfall other stablecoins have fallen into is not having a meaningful supply contraction while under peg. They would allow you to burn native tokens in return for a debt coupon with a premium attached. Those debt coupons were redeemable 1:1 for the native token later on. This means that while supply is being burned now, even more will need to be minted in the future to cover the premium offered as an incentive.

To avoid the issue of an ever growing supply they enforced an expiration on the debt coupons. This risks 100% capital loss to users who bought coupons that ultimately expire.

Malt wants to avoid the expiration on the tokens so must reconstruct the system to allow for a meaningful supply contraction while under peg.

This is where the liquidity extension gets actively deployed. The protocol controlled liquidity extension capital is used to buy and burn additional Malt during an auction to offset the premium that will be paid in the future. The exact amount of internal capital used is determined via some strict rules that will be elaborated on later.

While the arb tokens are redeemed for non-native tokens, those non-native tokens are acquired by selling freshly minted malt. Therefore, just like other stablecoins Malt needs to mint enough Malt to cover the premium offered. This is why additional Malt is burned by the stabilizer node using the liquidity extension.

More information on the specifics of how the stabilizer node uses the liquidity extension during the auction is presented in the “Auction setup” and “Auction finalization” sections below.

