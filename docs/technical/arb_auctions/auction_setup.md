# Auction Setup

During this phase the following must be determined:

* Auction starting price
* Ending price
* Desired raise amount
* Reserve precommitment / preburn

The starting point is to determine the desired amount to raise during the auction. This is simply the amount of buying required to push the price back up to peg. Since every bid in the auction will be used to purchase Malt from the AMM pool the desired raise during the auction is related to the amount of buying required to return the pool to peg.

The same equation used above peg can be used below to determine the amount of the non-native token that needs to be used to buy Malt.

$$
tradeSize = \sqrt{k(\frac{sellTokenPrice}{buyTokenPrice})} - sellTokenReserves
$$

This is the total amount of purchasing required to return to peg but the desired raise from the auction is less than this because the pool’s liquidity extension will be used to purchase Malt as well.

So what is the split between auction raise and liquidity extension usage? The answer to that lies in the 3rd goal laid out in the 3 goals for the auction.

“Ensure the pod reserve ratio is dropping slower than Malt is being burned wherever possible.”

Let’s assume we are working in a Malt/DAI pool and assume that every DAI used to buy Malt via the auction \(either an auction pledge or liquidity extension usage\) purchases 1 Malt. Obviously, in practice 1 DAI buys more than 1 Malt on average during an auction as the price is under $1. Using the 1 DAI buys 1 Malt assumption gives the worst case.

For the sake of argument say there is 90k DAI and 100k Malt in the pool and there is 50k DAI of liquidity extension in the stabilizer node.

For illustrative purposes say there was no auction and instead only liquidity extension is used to buy back and burn Malt.

Say 5k of the reserve liquidity is used to buy Malt \(assuming 1 DAI buys 1 Malt\) and 5k Malt is bought and burned. This reduces Malt in the pool by 5% while reducing reserves by 10%. In this case reserves are dropping faster than Malt is being burned which violates the goal laid out above.

The equilibrium point where the reserves deplete at the same rate as Malt is burned is found. The size of the reserves is measured as a percentage of the Malt in the liquidity pool.

If we assume a reserve ratio of 30% then for every 1 Malt in the pool there is 0.3 DAI in the reserves. The value in the reserves is 0.3 of the value in Malt in the pool. Therefore the equilibrium point where the reserves deplete at the same rate as the Malt is when the reserves deplete 0.3 for every 1 Malt burned. That will ensure the relative % change in each remains the same.

More generally:

$$
Equilibrium reserve depletion = {reserveRatio}\times{maltBurned}
$$

For a 40% reserve ratio and 500 Malt burned then 200 DAI can be used from reserves while maintaining that equilibrium.

