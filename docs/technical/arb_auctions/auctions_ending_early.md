# Ending Early

All of the calculations up until now have been done assuming the price of the auction reaches the minimum price. This is a worst case analysis. Of course, this won’t always be the case so let’s take a look at what happens if the auction ends before the minimum price is reached I.E the auction reaches its desired raise amount before the 30 minutes is up.

Again, assume a reserve ratio of 30%, min price of $0.70 and required buying of $1000 \(and therefore a desired raise in the auction of $700\).

The auction receives $700 of bids ending the auction at a price of $0.80. This means the protocol only needs to use $0.20 from reserves to make up the $1 required to burn enough malt to remain supply neutral.

This leaves the protocol in an interesting position. It can simply use $0.2 per arb token to burn enough Malt and leave it at that or because it can spend up to 30% to burn a Malt while still maintaining the depletion equilibrium it can elect to spend more from reserves to burn additional Malt realising a real supply contraction.

If it chooses to just spend the $0.2 then it is depleting the reserves slower than it is burning Malt and that will go towards improving the reserve ratio over time and if it decides to burn additional malt then the depletion speed is the same but the net effect to supply is a realised contraction.

Having these options at its disposal is powerful as over time better heuristics can be developed to help to decide whether to burn additional supply and improve token economics or to keep the net neutral effect on supply but improve the reserve ratio.

## It’s not all the worst case

The assumption that it will cost 1 DAI to purchase 1 Malt has been used thus far. In practice though, the price is under peg and it will cost on average less than 1 DAI to purchase 1 Malt. This improves things from the perspective of the protocol as less than 1 DAI is needed to purchase 1 Malt and therefore the excess the reserves have to cover is less.

For example, assume the average purchase price of Malt is $0.95 and the auction ends at a price of $0.80. In this case only $0.15 from reserve capital needs to be used to make up the difference as opposed to the $0.20 needed when it was assumed to cost $1.

This favorably skews the equations towards the protocol as it needs to spend less capital to gain the same results. This will mean that much like in the case where the auction doesn’t end at the minimum price there will be excess capital the protocol can choose to use to strengthen reserves or to burn additional supply.

