# Improving Reserves

It is now known what is required to maintain the same rate of depletion of reserves relative to burning of Malt. However, it is now possible to think about deviating from that such that reserves are depleted slower than the Malt is being burned. The reserve depleting slower than the rate at which Malt is being burned goes towards improving the reserve ratio.

For example, say there is 100 Malt in a pool and 30 DAI in reserve. This represents a 30% reserve ratio. Say 10 Malt is burned, the equilibrium would be using 3 DAI from reserves. However, instead say only 2 DAI is used. This leaves the pool with 90 Malt after the burn and 28 DAI in reserve. The new reserve ratio is 28/90 = 31.11% - an improvement from the original 30%!

This insight is crucial to understand the internal mechanism used to decide how much reserve capital to use during an auction.

The auction setup assumes that if the auction is fully subscribed the reserve usage will be in equilibrium with Malt burned. It is known from the previous calculations how much Malt needs to be bought to return to peg and the assumption was laid out that burning 1 Malt requires 1 DAI.

The worst case assumption was made that 1 DAI is required to buy 1 Malt. It is also known that every arb token is redeemable for $1 of value later when Malt is back to peg \($1 = 1 Malt\). Therefore regardless of the price of the auction 1 Malt must be burned now for every arbitrage token bought during the auction to ensure the auction at least has a net neutral effect on the total Malt supply \(in practice we may want to burn more than 1 Malt per arb token to have a meaningful supply contraction\).

Armed with this knowledge it can be seen that if the auction ends at a price of $0.80 then another $0.20 has to come from somewhere to burn sufficient Malt to remain supply neutral. That additional amount will come from the reserve.

It has already been shown what the constraints on the usage of reserves to burn Malt are. The fact that reserves must be used to make up the difference in the auction price to burn enough Malt and the fact that there are constraints on how much reserves can be used to burn Malt all imply a minimum price of the auction. The auction lasts 30 minutes and will linearly move from the starting price to this minimum price over the duration of the auction.

More concretely, if the current reserve ratio is 30% then as seen above no more than $0.30 in DAI can be used from reserves per Malt burned. The assumption is that it costs $1 to burn 1 Malt in the worst case therefore the lowest possible auction price is $0.70 as this would require $0.30 from reserves to be used for every Malt burned.

Generally:

$$
minPrice = averageMaltPurchasedPrice - reserveRatio
$$

Where averageMaltPurchasePrice is the average price paid for Malt during the course of the auction. Of course this cannot be known ahead of time but a good estimate will be halfway between the current market price and the peg price.

For a reserve ratio of 40% the min price would be 1 - 0.4 = $0.60. In this sense it is seen that the higher the reserve ratio, the lower the auction can go which conceptually makes sense as the protocol has more capital on hand to backstop the auction.

The minimum price of the auction also implies the maximum desired raise from the auction given a total required amount of purchasing on the AMM.

When the auction is at the minimum price that is when the protocol has to use the most reserves. Assume a min price has been determined to be $0.70 \(due to 30% reserve ratio\) then that means that at that minimum price the protocol needs to contribute $0.30. If the desired buying pressure is $1000 then no more than $700 can be raised from the auction otherwise the reserve contribution will result in more buying than desired. Therefore the desired raise from the auction bidders is $700.

The equation that governs this is: 

$$
desiredRaise = requiredBuying\times (1 - reserveRatio)
$$

Using the above example again:

$$
desiredRaise = 1000 \times (1-0.3) = 700
$$

