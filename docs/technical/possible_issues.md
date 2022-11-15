# Possible Issues

## No participation in auctions

The biggest potential issue Malt could run into is having little to no participation in the auction. While the reserves can be used to bolster the auction there can come a point if the price keeps dropping where the reserves are no longer enough and can’t keep price up. If this happens then the Malt mechanism could lose control of the peg and the price freefalls.

It is of utmost importance to keep participation in auctions high, especially in periods of low demand or high supply of Malt. In such periods many auctions will trigger in succession. Each successive auction will try to increase the reserves as best it can. This is only possible with auction participation.

The hope is that the auction mechanism will be able to shrink supply and boost its own reserve ratio such that the supply demand equilibrium is found as soon as possible. When that equilibrium is found the protocol can start to work through the backlog of arbitrage tokens accrued during the period of successive auctions.

## Arb token backlog

During times of successive auctions a backlog of arbitrage tokens from all of these auctions will build up. Fortunately, these tokens never expire but without improving the economics of the token there is little possibility of making a meaningful dent in clearing them. This is why each successive auction will burn supply. That reduction in supply will eventually find the equilibrium where price can start to move above peg again as the demand starts to outweigh the supply. This will allow the tokens to be cleared over time.

This can be thought of as “price discovery” but for total supply. The supply is floating up and down constantly trying to find the point at which it is in a supply/demand equilibrium. This kind of hyper elastic supply discovery is an exciting area of crypto.

## Above/below peg cycle asymmetry

Another plausible issue we see is the asymmetry of stabilization above and below peg. Above peg can be stabilized much quicker than below peg can. This means that any kind of meaningful selling will drive price down but any meaningful buying will immediately get cancelled when the stabilization triggers.

This is likely to create an equilibrium where price finds stability just under peg.

To get around this there is an above peg “damping” factor that can be turned on via governance. This will mean that the above peg mechanism doesn’t sell the entire amount in one go but instead only sells a portion of the amount required to return to peg. This will even out the asymmetry in the cycle times and \(hopefully\) move the equilibrium point up again such that it is stable at the peg price.

