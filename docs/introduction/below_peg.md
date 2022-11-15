# Below peg

* There is a dutch auction to purchase malt arbitrage tokens.
* The auction price will start around $1 and steadily drop over the course of 30 mins.
* Bidding in the auction is in DAI \(in the case of Malt/DAI pool\).
* The auction ends after 30mins or until a predetermined amount of money has been pledged to the auction.
* Every bidder gets the final price of the auction regardless of when they bid.
* Each arb token is redeemable for 1 DAI.
* The protocol will automatically redeem these tokens to avoid bot wars.
* The tokens never expire.

On the surface this sounds similar to the ESD-esque coupons but there are some very distinct differences that will be elaborated on below.

* Arb tokens are acquired by buying them with DAI as opposed to the ESD method of burning ESD in exchange for the coupons.
* All DAI pledged to the auction will actually buy Malt on the open market and burn it. This guarantees auction participation creates buying pressure.
* The arb tokens do not need to expire as there is a guaranteed supply contraction due to usage of the stabilizer liquidity to buy and burn additional Malt during the auction.
* No bot wars to redeem the tokens as the protocol will automatically redeem them pro-rata across all buyers.
  * IE if 10% of the tokens for a given auction are redeemable then every buying automatically has 10% of their tokens redeemed.
* Redeemed tokens are paid out in DAI avoiding additional profit realizing sell pressure after token redemptions.

