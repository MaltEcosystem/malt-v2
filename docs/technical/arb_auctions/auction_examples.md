# Examples

## Example where auction is fully subscribed

Pool: Malt/DAI Reserve ratio: 30% Auction desired raise: $700 Finishing price $0.80 Average Malt purchase price: $0.95

$700 was used to purchase arbitrage tokens at a price of $0.80 - 875 tokens purchased.

The premium excess is the amount of reserve capital the protocol must use to cover the premium of the auction. Without this the auction could have a net increase to supply.

$$
premiumExcess = totalTokens(avgMaltPrice - finalAuctionPrice)
$$

For this example: 

$$
premiumExcess = 875(0.95 - 0.80) = 131.25
$$

If the protocol simply covers the premium excess then 875 Malt will have been burned using 131.25 DAI from reserves. That represents 15% reserve usage relative to Malt burned.

The protocol can cover up to 30% therefore the max spend is:

$$
maxBurnSpend = \frac{totalAuctionBids}{avgMaltPrice - reserveRatio}-totalAuctionBids
$$

$$
maxBurnSpend = \frac{700}{0.95-0.3} - 700 = 376.92
$$

$$
usableExcess = maxBurnSpend - premiumExcess
$$

Subtracting the required premium excess spend from the max spend we get the usable excess of 245.67.

The protocol can choose to keep that 245 and just spend less than the 30% and improve the reserve ratio or it can choose to spend some or all of it to burn more than necessary to realise a supply contraction.

## Example where auction is undersubscribed

Pool: Malt/DAI Reserve ratio: 30% Auction desired raise: $700 Auction actual raise: $500 Finishing price $0.70 Average Malt purchase price: $0.92

$500 was used to purchase arbitrage tokens at a price of $0.70 - 714.29 tokens purchased.

premiumExcess = 714.29\(0.92 - 0.70\) = 157.14

maxBurnSpend = 5000.92 - 0.3 - 500 = 306.45

usableExcess = 306.45 - 157.14 = 149.31

Even when the auction is not fully subscribed due to the worst case assumptions in the planning of the auction there is still a buffer for the protocol to work with.

