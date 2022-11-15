# LP Rewards

LP rewards are generated above peg when the stabilizer node mints malt and sells it into the AMM pool. This stabilizing action can be triggered by anyone as soon as the twap deviates 1% away from peg. The protocol receives another asset in return for the Malt sold. This is profit the protocol has made and it will distribute that in the following way:

* A value equivalent to the minimum pod reserve ratio is put into pod reserves. Meaning if the minimum pod reserve ratio is 20% \(the default\) then 20% of the profit will be put into the pod reserves as liquidity extension.
* 90% of the remaining profit is distributed to LP stakers
* 5% of the remaining is given to the treasury.
* 5% of the remaining profit is given to the caller that triggered the stabilizing action.

This means all mining rewards are paid in a non-native token which has powerful consequences that will be explored in more detail later on. A byproduct of this is that users will eventually be able to choose which token to get rewarded in by LPing in the Malt/asset pool where “asset” is the token they want to be rewarded in.

This incentivizes more liquidity in the tokens the community is more bullish on. Having more liquidity to trade against the most popular coins is a strong way to position Malt as a strong defi native stablecoin. This is another small way in which Malt tries to align incentives for the benefit of the protocol.

The amount of Malt minted by the stabilizer node is calculated using the following equation:

$$
tradeSize = \sqrt{k(\frac{sellTokenPrice}{buyTokenPrice}}) - sellTokenReserves
$$

sellTokenPrice and buyTokenPrice are the true prices of the two assets in the pool. K is the invariant in the xy=k.

Concretely, let’s say we have a Malt/DAI pool that has 100,000 DAI and 80,000 Malt in it currently. With those reserves in the pool the current price of Malt is $1.25.

The true price of both assets is $1 therefore the bracketed part of the equation all equals 1.

The sellTokenReserves in this case is the reserves of Malt which is 80k.

$$
tradeSize = \sqrt{8,000,000,000} - 80,000
$$

Working through the calculation we will find that we need to mint 9442.71 Malt to return the price to peg.

Due to the price currently being above peg $1.25 in the example above the price we will receive for selling that Malt will be greater than $1 so we will receive more than 9442 DAI.

For the sake of simplicity say we receive 10k DAI in return. That will be distributed in the following way:

* 2000 to pod liquidity extension.
* 7200 to the liquidity mine to distribute to LP stakers
* 400 to the caller that triggered the stabilization
* 400 to the Malt treasury.

