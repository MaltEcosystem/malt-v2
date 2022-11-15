# Per Pool Stabilization

Most algorithmic stablecoins approach the problem globally. They build a mechanism that provides a generic ability to globally increase/decrease the supply. This often takes the form of a mint/redeem functionality. While there is nothing inherently wrong with this approach it is hard to predict the unknown complexity that will show itself later.

These mechanisms sometimes rely on price oracles - but the problem is that there are many pools. Are you averaging the averages of each pool? There may be cases where the global oracle isn't moving fast enough to allow the mechanism to work efficiently.

Malt takes a different approach. Malt stabilizes each pool individually. The price oracle isn't global it is just for the exact pool in question. This removes issues with averaging across many. The total problem space is a lot simpler when you only have to consider each pool in isolation instead of the complex interactions between them all.

Obviously, there will be many pools. However, Malt assumes that arbitrage between them will provide the mechanism of "communication" between them such that each stabilizer only needs to worry about its own pool and information from other pools will flow into it via arbitrage.

Concretely, lets say there is a Malt/DAI pool and a Malt/FRAX pool. This means there are two different stabilizer pods in operation (one for the DAI pool and one for the FRAX pool). The DAI pool might drop to a Malt price of $0.90 while the FRAX pool is lagging at $1 still. The FRAX pool is unaware the DAI pool has dropped below peg. At this point a wannabe arbitrageur could use some DAI to buy Malt then sell that Malt for FRAX. Lets say they use 0.9 DAI to buy 1 Malt then they sell that for 1 FRAX - they could then optionally swap 1 FRAX for 1 DAI on Curve for example. They have now profited risk free.

But what has happened to the pool in this case? The DAI pool had some buying pressure pushing it back towards peg and the FRAX pool had some selling to push it down. In this way the arbitrage will help distribute the global drop in demand across each pool. 

Instead of having one pool at $0.9 and the other at $1 we will have both at $0.95. Now each pool can go about its isolated job of returning it's pool back to peg. Of course, some pools will find it easier to recover as they have more collateral available to them. Again, the arbitrage will act as a medium for the stronger pools to distribute funds to the weaker ones. The stronger pools will recover while the weaker ones will still be under peg. An arbitrage now exists between them and funds get moved from the strong pool to the weak one.

This processes of explicitly treating arbitrage as a communication medium between pools drastically reduces the complexity involved in stabilization as the problem simplifies down to a single pool.
