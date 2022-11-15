# Getting the auction started
Once the Auction Base contract has decided on how much the auction needs to raise, the protocol will use some of its reserves to pre-commit some of the desired raise. This amount is decided upon using an initialPledgeFactor which is a property that exists in the contracts.

The desired raise is divided by the initialPledgeFactor and that amount of reserve capital is pre-committed to the auction. This provides an initial price boost to the auction to kick things off.

Any subsequent bidding on the auction will go to replenishing the reserve capital used. As soon as all the initial pre-commitment has been repaid to the protocol all subsequent bidding will be used to buy from the AMM.

Having this precommitment lowers the overall average price of purchased Malt as the pre-commitment purchasing happens right at the start of the auction when the market price is lowest. Once the auction purchasing starts to kick in it pushes the price up and other organic activity may push the price higher still.

## Auction Pricing
Up to this point the discussion has been around how much the auction needs to raise and what the absolute minimum price the auction can end is. It has also been shown that it is beneficial to the protocol if the auction ends above that absolute minimum price as it provides additional optionality to the protocol.

To this end the protocol will try to set the actual minimum price of the auction as high as possible while still maintaining a good margin for a premium to those who purchase the arbitrage tokens.

The process for deciding the auction starting and ending prices starts by defining 3 potential ending prices.
1. The ideal end. 1 - the reserve ratio
2. The midpoint. The mid point between the current market price and 1 - the reserve ratio.
3. The absolute bottom. Current market price - the reserve ratio.

With those 3 defined the process of deciding the real starting and ending prices uses the following steps:
1. Find the distance between the current market price and the peg price. Call this the price deficit.
2. Using outer bounds of the peg price and the ideal end price try to place a real start and end price such that it is as wide as possible but the real market price of malt is no more than 25% away from the start price on the way to the end price.
3. If it is not possible to achieve that using the ideal end candidate price (I.E the current market price is below the end price) then repeat step 2 using the midpoint candidate as the ending price.
4. If it is again not possible using the midpoint then use the absolute bottom price and repeat step 2.
5. If it is still not possible to find a start and end price that satisfies the constraints then set the starting price of the auction to the current market price and the ending price to be the absolute bottom.

Using this scheme the auction will try to have 25% of the auction duration above the Malt market price at the start of the auction. However, due to the initial pre-commitment the price of malt in the AMM pool will be higher than this when the actual auction starts accepting bids. 

This system also ensures that the ending price of the auction is as high as possible without sacrificing a potential premium to bidders. The buffer above the absolute minimum price guarantees the protocol has some room to work with to decide to burn additional Malt or expand the reserves - even if the auction ends at the minimum price.
