# Stake Padding
Stake padding is a concept used in the reward mine contracts that is there to track how much each account is allocated in total rewards.

Stake padding is a mathematical construct that allows for simple accounting of reward allocation for each LP. The padding itself is just another value attached to each user that is use in conjunction with their ownership % of total LP and declared rewards.

Here is a concrete example:

1. User 1 bonds 100LP
2. $100 of rewards are declared
3. User 2 bonds 100LP

At this point we have two users that each own a 50% share of the LP while User 1 should have 100% share of the rewards. User 2 isn't eligible for any rewards as the $100 was declared before they bonded.

We need a way of reconciling this. The solution is to introduce another value called "Stake Padding". This stake padding given to a user will be sized such that their allocated rewards + their stake padding is the same proportion of the global total stake padding + globally declared rewards as their share of LP is to the entire bonded LP.

Going back to the above example:

1. User 1 bonds 100LP and is (arbitrarily) assigned 100 in stake padding. a. Let's call total declared reward + total stake padding "fullyPaddedReward". Right now that equals 100.
2. $100 of rewards are declared a. fullyPaddedReward now equals 200. (100 padding + 100 reward).
3. User 2 bonds 100LP. At this point user 2 owns 50% of LP. They need to be given some stake padding such that their share of fullyPaddedReward is also 50%. a. User 2 given 200 stake padding. fullyPaddedReward is now 400 (200 user 2 padding + 100 user 1 padding + 100 reward) and user 2 owns 200 of it, which is the desired 50%.

Here is a visual representation of the above description:

![Stake padding visual diagram](https://raw.githubusercontent.com/code-423n4/2021-11-malt/main/assets/stake_padding.png)

In practice the fullyPaddedReward and a given user's stake padding is known and their reward is the unknown.

That would look something like this:

![fullyPaddedReward](https://raw.githubusercontent.com/code-423n4/2021-11-malt/main/assets/stake_padding_example.png)

Calculate user 1 reward given:

* The above fullyPaddedReward of 400
* User 1 stake padding of 100
* User 1 owns 50% of LP

1. User 1 must own 50% of fullyPaddedReward. Therefore their share is 200
2. A user's share of fullyPaddedReward is made up of their personal stake padding + their rewards.
3. User 1's stake padding is known to be 100. a. Therefore, their share of 200 minus their stake padding of 100 leaves their reward to be 100. We know this is correct based on the previous example.

Now assume another $200 of rewards is dropped in (after user 2 bonded their 100 LP).

fullyPaddedReward is now 600: the previous value of 400 + the new 200 of rewards. Stake padding is unchanged as no bonding / unbonding has occurred.

Before going through the calculation, what is the expected result here?

* User 1 still owns the full 100 from the first reward.
* Because users 1 and 2 own 50% each when the second reward comes through they each get half. Therefore 100 each.
So the final tally should be: User 1: 200 User 2: 100

Now the calculation:

1. User 1 still owns 50% of the fullyPaddedReward. Using the new fullyPaddedReward value of 600, their share is 300
2. User 1's stake padding is known to be 100. a. Therefore, their share of 300 minus their stake padding of 100 leaves their reward to be 200. Exactly as expected.

For user 2:

1. Owns 50%. Their share is 300
2. As per above calcs, user 2 has a stake padding of 200. a. Therefore, their share of reward is 300 - 200 = 100. Just as expected.
