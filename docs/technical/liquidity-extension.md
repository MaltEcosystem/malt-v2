# Liquidity Extension

Liquidity extension exists to facilitate offering a premium in the dutch auction (a delta between auction price and AMM price). For example if the average purchase price of Malt burned during an auction is $0.90 and the final price of the dutch auction is $0.80 then that suggests a $0.10 premium.

What that premium implies is that for every arb token purchased less than 1 Malt was burned. Each arb token is redeemable for $1 and the redemption is covered by the above peg mechanism of minting and selling Malt. Worst case, that means 1 Malt must be minted to cover a single arb token. If the protocol is burning less than 1 Malt to create an arb token and minting 1 to redeem it then there is net supply growth through the entire end to end auction process. This is undesirable.

This is where liquidity extension steps in and will attempt to at the very least cover the premium such that the auction burns at least 1 Malt for every arb token created. The liquidity extension can choose to burn more if it has budget - this will realise a real net supply contraction through the auction. It can also choose to keep the auction net neutral to supply and instead retain capital.

There are constraints limiting exactly how much capital the liquidity extension is allowed to use on any given auction.

That constraint is related to the liquidity extensions "reserve ratio" which is the ratio of capital in the LE against the amount of Malt in the AMM pool (actually implied amount of Malt in the pool given current value of k and the target price ie how much Malt is in the pool if the price is $1 and the value of k is X?)

If LE reserve ratio is 40% then LE has $0.40 for every Malt that should be in the pool if the pool was at peg. Therefore, the LE should refuse to spend more than $0.40 to burn a single Malt. If less than $0.40 is used to burn Malt then the global collateralization of Malt improves. Concretely, 100 Malt in pool and 40 DAI in LE. Say LE uses $0.20 to burn 1 Malt. LE dropped by 0.5% while Malt supply dropped by 1%. This difference in the rate of change of Malt supply vs LE ensures the
process is sustainable.
