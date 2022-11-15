# High Level Overview

Malt's primary goal is to maintaining 1 Malt = $1. Achieving this is requires just 2 things:
1. Create Malt sell pressure when the price is above the $1 peg.
2. Create Malt buy pressure when the price is below the $1 peg.

So how does Malt achieve both of these while also generating yield for the LPs?

#### Create Malt sell pressure when the price is above the $1 peg
This one is easy. The Malt smart contracts are the bank and have the power to mint new Malt. When the price rises away from the $1 peg the protocol will respond by minting fresh Malt and selling it. The exact amount of Malt minted is calculated to be just the right amount to return price to peg.

Demand increases -> price increases -> supply increases to correct price back to $1.

Selling the freshly minted Malt generates profit for the protocol (the protocol minted the Malt for free and sold it for some amount larger than $1).

The profit is then distributed to 2 places:
1. To LPs as rewards
2. To the "peg defences" (this system will be elaborated on later in the docs).

#### Create Malt buy pressure when the price is below the $1 peg
Historically, under peg has been the weak point for algo stables.

How does Malt solve the problem?

1. The capital in the "peg defences" buys back Malt during Recovery Mode (more on how this works and how it avoids front running later).
2. By selling "Arbitrage Tokens" using a Dutch Auction. Capital raised through this mechanism is used to buy back Malt. A premium is given to the Arbitrage Tokens relative to the underlying Malt price. This allows speculators to profit on making a bet that the peg will be restored.

More on the specifics of how this all works is further along in the docs. However, be sure to note that the Malt under peg mechanic offers the following features:
* Protection against bots frontrunning and sandwiching buy backs.
* Market driven premium to price the risk of Arbitrage Tokens.
* Guaranteed minimum of a net neutral supply change through the entire Arbitrage Auction process.
* Ability to exit your Arbitrage Token position early to partially realise profit.
