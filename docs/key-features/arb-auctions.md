# Arbitrage Auctions

Arbitrage Auctions are a dutch auction that allows for rapid price discovery on the risk premium for speculating on Malt returning to peg. The processes of speculators pricing this risk itself provides direct buying pressure on Malt that helps return it to peg.

Arbitrage Auctions only happen in Recovery Mode so there is no risk of bots sandwiching the auction processes to extract value.

The processes is as follows:
1. The dutch auction starts at the current market price and drops to some predetermined minimum price over the course of 10 mins.
2. Users can pledge money to the auction. The auction ends when a predetermined amount of capital is raised or when the 10 minutes is up - whichever comes first.
3. The auction is a single clearing price auction. Meaning everyone gets the same price regardless of when they pledged. Let's say you put $24 into it when the auction price is $0.80 and the auction actually finishes at $0.60. You initially expected to get 30 Arbitrage Tokens (0.8 into 24) but you will actually receive 40 tokens because the auction finished at $0.60.

Each Arbitrage Token then has a claim to $1 of rewards when the protocol is back at peg and has enough liquidity to pay the rewards out.

Behind the scenes all the capital given to the Arbitrage Auctions is used to buy Malt on the AMM (Recovery Mode allows auctions to buy) and that Malt gets burned to reduce the supply. So we are directly seeing buying to return price to peg and we get supply contraction to improve the supply/demand imbalance that lead to the depeg.

There is also a process that uses the Liquidity Extension to ensure that the Arbitrage Auction processes is guaranteed to be at least neutral to the supply even after paying back all the Arbitrage Tokens. This is a core problem that other projects like ESD ran into with their under peg mechanism.
