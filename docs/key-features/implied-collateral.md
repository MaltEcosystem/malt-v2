# Implied Collateral

Implied Collateral is at the very core of the Malt V2 design. But what is it? In short its using capital available to the protocol as collateral but only when it is needed - otherwise the capital serves another purpose.

Lets start by going over what collateral is then we can add in why we call ours "implied".

Collateral is value (other coins, assets etc) that is used to "back" something else. Let's consider the simplest example in crypto - USDC. For every USDC coin that exists on chain there is a real dollar in a bank account somewhere in the real world acting as collateral for the coin. This means that if you hold a USDC you are eligible to redeem it for the real dollar. This "collateral" is what allows USDC to hold its value at $1 per coin. If the price drops to $0.90 you could buy USDC for $0.9 then immediately redeem it for the real dollar and make $0.10 of risk free profit. This process of arbitrage keeps the value pegged.

A more complicated example is DAI that has other crypto coins as collateral. However, instead of having $1 of collateral for every 1 DAI there needs to be MORE than $1 for every DAI due to the fluctuations in the value of the collateral (it is crypto after all).

Whats the problem with this? For a start it's not very efficient to have a bunch of stuff just sitting there purely to "back" the value of something else. Secondly, in the case of DAI it's even more inefficient to require even more collateral than the value of the coin.

#### So what is implied collateral?
Implied collateral is Malt's solution to the efficiency problem. Throughout the process of Malt doing its job it generates profit which is put into one of the following places:
1. Reward Overflow - Once the desired APR for the current epoch is reached any additional LP profit share goes here. This then gets dripped back to LPs during epochs where the APR doesn't reach the desired level.
2. Auction Pool - This is capital set aside to give to LPs just like regular rewards. However, the reward is only unlocked when the capital is used in an Arbitrage Auction first. This process is automatic.
3. Swing Trader - This is Malt "arb bot". It uses the capital it has available to it to buy Malt under peg and tries to sell it above peg.
4. Liquidity extension - this is actually more like traditional collateral that gets used during Arbitrage Auctions.

So above we can see there is a lot of places capital exists inside the protocol all of which can be used to defend peg should it be required. But all of it has another purpose. This dual purpose collateral is what we call "Implied Collateral".

**Reward overflow is capital to fund LP reward runway. But it will be used as collateral to buy back Malt should Malt lose peg**

**Auction Pool is capital for LP rewards but MUST be used to automatically defend peg before its released to the LPs**

**Swing Trader buys back Malt and attempts to profit by selling it above peg later. Part of this profit is given to LPs and the rest goes to growing the Swing Trader**
