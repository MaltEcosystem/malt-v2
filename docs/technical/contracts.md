# Breakdown of the core contracts

### AbstractRewardMine
This is an abstract class that contains the core functionality for tracking the rewards for a set of bonded LPs. It is set up to support independently tracking the total declared reward as well as the total released reward.

When declared and released are the same, it functions as a straightforward liquidity mine style contract where rewards are divided pro-rata all currently bonded LPs. However, when these values differ it allows for vesting behaviour. The exact behaviour will be defined by the inheriting contract.

In the case of vesting rewards it is desired that a user is only eligible for rewards that where declared (but not vested) before that user bonded their LP. Eg.

1. User 1 Bonds 100 LP
2. $100 of rewards are declared
3. 1 minute later User 2 bonds 100 LP

In this situation, Users 1 and 2 both own 50% of the bonded LP, however User 1 should own all of the declared reward. Although almost none of that reward is vested yet (only 1 minute into the vesting period). The contract uses what we call stakePadding (discussed in more detail below) to keep track of this ownership.

In the Malt codebase there are two contracts that inherit from AbstractRewardMine. They are:

* ERC20VestedMine
* AuctionPool

The main methods for returning reward balances are:

* balanceOfRewards(address) - returns total rewards allocated to that address (these rewards are not necessarily available yet as is the case with vesting)
* earned(address) - the current balance of rewards that are fully vested and ready to withdraw / reinvest.

### AuctionBurnReserveSkew
This contract is used at the end of an arbitrage auction to decide how much the liquidity extension should skew towards burning Malt to contract supply vs maintaining supply and retaining capital in the liquidity extension contract.

It takes into consideration how frequently the price of Malt has been stabilized above vs below the peg and how subscribed the previous auctions have been.

If the price has been stabilized from above peg more frequently and auctions are fully subscribed in recent history then the contract will decide to burn more supply. If price spends more time below peg and the auctions are less subscribed then the contract will be more conservative and try to retain capital where possible.

### AuctionEscapeHatch
When a user participates in an auction they are effectively buying a binary option on Malt returning to peg. If Malt never recovers they suffer a 100% loss as the arb tokens are worthless until they are redeemed. If Malt does recover and the arb tokens are redeemed then the user gets the fully premium of the arb tokens. This is an undesirable risk profile.

To mitigate the binary nature of this, the AuctionEscapeHatch contract allows users to exit their arbitrage token position early.

When a user purchases arb tokens, their capital is used to buy Malt. The price paid for the Malt is tracked. This price paid is the set point by which early exists are judged (as opposed to the dutch auction price paid).

If the current Malt market price is below the Malt price paid by a user in an auction then the user can exit at the loss (ie their Malt purchase price was $0.90 and the current market price is $0.80, then they can accept a $0.10 loss per arb token).

If the current Malt market price is above their Malt purchase price they can exit at 20% (configurable) of the trade's profit. IE if they got in at a Malt price of $0.8 and the current price is $0.9 then they can exit at $0.82.

This system is meant to encourage users to hold for the full profit while giving them the flexibility to control their risk a little better than a pure binary option.

### AuctionParticipant
The AuctionParticipant contract is meant to be inherited by other contracts and provides the ability for the contract to participate in auctions. It can use capital the contract has to purchase arbitrage tokens and redeem them when available.

In the current Malt system there are 2 contracts that leverage the AuctionParticipant:

1. AuctionPool - uses capital to purchase arb tokens which are then pro-rata claimable by bonded LPs when the tokens are redeemed.
2. RewardOverflowPool - uses funds in the overflow to purchase arb tokens and all profit from arb tokens is just retained by the overflow pool to fund future reward underflows.

### AuctionPool
A portion of above peg profit is directed to the AuctionPool contract. This capital is then used to automatically participate in the auctions (using the AuctionParticipant) and the revenue received from redeeming those auction arbitrage tokens is then distributed pro-rata to LPs.

This pool can be thought of as regular LP reward except the capital has to be used in an auction (and thus it also grows by the auction premium) before the user is allowed to withdraw / reinvest it.

The AuctionPool sows the seed of implied collateral. The capital in this contract is allocated for user rewards but before it can be distributed to users as rewards it must act as collateral to defend peg. This multiple simultaneous use cases for the capital is the basis of implied collateral.

### Auction
The core contract that implements all the logic required for the dutch auctions. Auctions are triggered by the StabilizerNode whenever the price of Malt falls below the peg price.

This contract handles purchasing arb tokens, redeeming them pro-rata in auction order (ie auction 0 gets fully filled before auction 1 gets any) and users claiming available tokens.

### Bonding
The core contract that user's bond their LP into. It stores all the LP and keeps track of each user's bonded amount. It calls onBond and onUnbond hooks on the MiningService which then alerts all reward sources (inheritors of AbstractRewardMine) so each source can correctly track each user's ownership of its respective reward pool.

The two main methods on this contract are bond and unbond.

### DAO
The main goal of this contract in the current system is keeping track of the current epoch. It has an advance method to tick the epoch over and all other contracts lean on this one if they need to know the current epoch.

### UniswapHandler
A helper contract that allows other contracts to easily interact with UniswapV2 style AMMs. Each Malt pool will have it's own handler.

* Buying Malt
* Selling Malt
* Adding liquidity
* Removing liquidity
* Fetching live data from the pool

### ERC20VestedMine
The core reward source for bonded LPs. It inherits from AbstractRewardMine and works closely with the RewardDistributor to implement the reward vesting seen in Malt. More on this interaction below.

### LiquidityExtension
The core goal of this contract is to facilitate the auction premium without net supply inflation after the premium has been paid off. The amount of "arb tokens" the user receives from the auction is determined by the final price of the auction (reached either at the end of the allotted time or when the auction is fully subscribed). Each arb token is worth $1 (in DAI initially) when Malt is back to peg and above peg profit pays down the tokens. This process implies that each arb token is worth 1 Malt when at peg. During the auction, all capital committed to the auction is used to buy Malt from the AMM and burn it. At the end of the auction it is known how many arb tokens have been created and how much Malt was burned. If less Malt has been burned than arb tokens created then that implies a required supply growth to pay down the tokens. Therefore, the protocol will endeavour to burn at least as much Malt as it creates arb tokens. This is the job of the liquidity extension. It can also choose burn more (which is where the AuctionBurnReserveSkew contract comes in) to see a net contraction of supply. The contract contains capital and a desired minReserveRatio, which is a ratio of capital in the contract against the Malt in the AMM pool the liquidity extension is paired with. Note that the "Malt in the pool" in this case isn't the actual Malt in the pool but instead the Malt that should be in the pool given the current value of k in the AMM and the current peg price of Malt.

### MaltDataLab
This is a contract that is used by all others to fetch data pertaining to the pool being stabilized. It makes use of MovingAverage contracts to provide flexibility over the length of time averages are calculated over.

Note the usage of our own MovingAverage is noted in the known issues and trade offs section below.

### Malt
The ERC20 contract for the Malt token itself. It uses open zeppelin contracts and implements mint and burn behind timelock permissioning.

The main deviation from a standard OZ ERC20 is the addition of the transferService.verifyTransfer(from, to, amount) call on the `_beforeTokenTransfer` hook. This allows some control over what transfers are allowed and which are not.

In practice the use case for this is to block buying Malt on a given AMM pool when that pool is a certain distance under peg. This is the so called "Recovery Mode" where the under peg mechanics take over to attempt to recover peg.

### MiningService
An abstraction that ties together multiple reward sources (implementations of AbstractRewardMine). Each reward source can be registered against the MiningService and will then be alerted when a user bonds or unbonds.

This contract also allows calling balanceOfRewards and earned which will sum the values across all registered reward sources.

### MovingAverage
An implementation that allows for multiple length moving averages to be calculated using a single contract. It is heavily inspired by uniswapV2 cumulativeValue implementation for TWAP.

A number of samples and sample length are specified on initialization of the contract and from there calls to update(uint) or updateCumulative(uint) keep track of all the samples.

It is then possible to make a call to get the average price over any period of time between 1 sample length and the number of sample * sample length.

Concretely, if the contract is set up for a sample length of 30 seconds and 60 samples then you can fetch the moving average of that data source anywhere between 30 seconds and 30 minutes in 30 second increments.

To avoid the ability to manipulate some of these values with flashloan attacks (say for example when tracking pool price) only permissioned addresses are allowed to call update.

A major drawback of this is the requirement to upkeep this contract by calling update on a frequent enough cadence. Chainlink keepers will likely be used for this purpose

### Permissions
This contract is the backbone of the protocol's access control. Almost every contract inherits from the Permissions contract which itself inherits from Open Zeppelin's AccessControl.

Some roles are implemented directly in the permission contract, but all inheriting contracts are open to define their own.

The permissioning contract also adds emergency withdraw to every Malt contract that is locked down to only the TIMELOCK_ROLE. This is done in an attempt to balance between the ability to rescue funds should issues arise in the contracts while avoiding any individual having too much privilege. Now should any reason arise to remove funds from a contract, it is possible, but only via the 2 day timelock.

### PoolTransferVerification
This is a contract that gets called via the TransferService when the Malt token is attempting a transfer. There can be many PoolTransferVerification contracts used, each with their own custom logic.

They must all contain a verifyTransfer method that returns true if the transfer should be allowed and false if it should be blocked.

### RewardReinvestor
A contract that simplifies the process for a user to reinvest their rewards. It has privileged access to the MiningService to be able to withdraw rewards on behalf of a user. It then interacts with UniswapHandler to create the LP tokens using the rewarded funds and then bonds that LP into the Bonding contract on behalf of the user.

This contract can almost certainly be improved upon in terms of efficiency as well as edge case handling

### RewardDistributor
The contract in charge of the vesting schedule for LP rewards. It implements the focal vesting scheme (discussed in the Technical Notes section below).

This contract is not aware of users or their bonded LP. Instead it just receives rewards from RewardThrottle and sends them onto ERC20VestedMine as they vest.

The main methods on this contract are declareReward and vest. declareReward can only be called by addresses with the THROTTLER_ROLE and it just lets the contract know about new rewards. vest will calculate how much reward has vested since the last time it was called and send that money to the reward mine.

### RewardOverflowPool
This is where excess above peg profit is kept when the Desired Epoch APR is reached for a given epoch. This capital can then be requested by the throttler contract when a subsequent epoch didn't reach its desired APR.

It is taking money from the rich epochs to give to the poor epochs. Ultimately smoothing out the inherently volatile and unpredictable nature of profit generation in Malt.

### RewardThrottle
In charge of smoothing out the protocol profit that is marked for user rewards. It works in tandem with the RewardOverflowPool to smooth out the rewards across epochs. It keeps track of the target APR for any given epoch and will redirect excess capital into the overflow pool and request capital from the overflow pool as needed.

### StabilizerNode
This contract is the "brain" of the stability system in Malt. It has a stabilize method that can trigger the protocol to take action towards stabilizing the AMM pool (remember that each AMM pool gets its own stabilizer system).

It uses a 10min TWAP with a 1% deviation threshold to trigger actions. TWAP > 1% above peg will trigger selling Malt (either freshly minted or from swing trader Malt holdings). TWAP > 1% below peg will trigger swing trader purchasing + arbitrage auction.

It also deals with automatic auction participation from AuctionPool and RewardOverflowPool.

This means when the implied collateral of the system is healthy almost all depeg events should be resolved in the stabilize transaction. Only when implied collateral isn't enough will the auction be turned over to the public.

### SwingTrader
Using all of its available power, the swing trader valiantly defends peg. Whenever general StabilizerNode informs SwingTrader of an opportunity it will jump into action by either using its collateral capital to buy back Malt or by selling the Malt it has available.

The swing trader gets an allocation of above peg protocol profit and that capital is then used to help defend peg. This is done from a privileged position though, as it is whitelisted to be allowed to purchase Malt from the AMM even when everyone else isn't. In doing so, the swing trader profits when peg is regained.

Over time, the aim is that the swing trader will make enough profit to fully collateralize Malt and then protocol parameters can be adjusted to direct more above peg profit to LPs.

### TransferService
This is a contract similar to the MiningService that abstracts one or more PoolTransferVerification contracts. The Malt ERC20 calls verifyTransfer on TranserService which then relays that call to the correct PoolTransferVerification contract(s). If one of these PoolTransferVerification calls returns false then TranserService will return false back to the Malt contract which will ultimately revert and block the transfer.
