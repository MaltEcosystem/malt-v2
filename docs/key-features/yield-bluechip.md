# Yield Paid in Bluechips

This might be the single most important part of the incentives and internal structure of Malt. Malt pays LPs yield in the non-native token of the pool.

Malt/DAI pays yield in DAI.
Malt/ETH will pay yield in ETH when it launches.
Malt/WBTC will pay in WBTC.
Malt/AAVE will pay in AAVE.
etc.

This has profound implications for LPs as well as the protocol itself.

#### LPs don't have the risk earned yield fluctuating with the protocol
You ever been in a farm that is printing? You are up 50% on your capital and life is good. Then you wake up to find the token has tanked and you are down money now. Yep, us too.

You haven't actually made any money until you sell the token. There is always risk on the table when you are still holding the native token. But remember, Malt was built for LPs - so Malt avoids this problem by just paying you in the non-native token. Even if Malt completely fails and Malt goes to 0 - your yield is still safely yours in DAI or ETH or whatever other token.

#### LPs get to choose which token they get paid in
Once Malt is mature and has many pools available LPs will get to choose which pool they provide liquidity to and therefore get to choose which token they want to get paid in.

Bullish ETH? Provide liquidity to the Malt/ETH pair and earn your yield in ETH.
Market going risk off? Move your liquidity into Malt/DAI and get paid in DAI.

This has deep impacts on the protocol itself:

#### The protocol's collateral reserves dynamically rebalance according to the market
The collateral reserve distribution of many other stablecoins is either fixed or determined by the leaders of the project. Malt stabilizes per pool, which means each pool has its own collateral in the non-native token of the pool.

This means the most popular pools (most liquidity) are forced to have more collateral to match the size of the pool. So Malt's collateral reserves are distributed according to market demand. 

Market is bullish ETH? Malt has more ETH in its reserves as the TVL of Malt/ETH pool grows.
Market going risk off? As people move into Malt/DAI and TVL grows then Malt is forced to collateralize with more DAI.

This is one of the beautiful market driven benefits that falls out of stabilizing on a per pool basis.

#### The protocol does have to absorb selling from farmers realizing profit
As most already understand, under peg is the place that most algo stables struggle the most. Yet many will still have liquidity incentives that are paid in the native token and therefore encourage selling as farmers take profit.

By paying the yield in the non-native token Malt removes this from the table. It also allows the protocol itself to control when the selling happens as a core part of the stability mechanism. Not only does it remove this bad feature but it turns it into a core part of how the protocol manages to stay stable. Incentive alignment.
