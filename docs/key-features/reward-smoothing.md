# Reward Smoothing

Malt is pretty good at making money. Its above peg minting produces profit and the below peg Swing Trader also produces profit. A portion of that profit is given to LPs.

However, instead of giving it all to LPs on the spot it will try to smooth it all out to provide more consistent returns over time.

For example in epoch 1 it makes $100k profit and in epoch 2 it makes $2k profit then epoch 3 makes $50k. LP rewards would be incredibly volatile. Predictability is desirable.

So instead Malt will try to pay a target APR per epoch (this APR is dynamic and market driven). Any rewards above that target APR for a given epoch will be put into the "Reward Overflow". Then later when there is an epoch that doesn't reach the target APR the protocol will pull rewards out of the overflow to top up the current epoch to the desired APR.

#### TLDR of how this works
Every epoch the protocol produces profit - call this the "Real Profit". Using the real profit and the currently bonded LP value we can calculate the "Real APR". This is the APR that would exist if ALL of the profit was paid out to LPs immediately. However, the actual APR paid out is calculated by using a throttle value that is set in the contract - say 20%. The desired APR is found by multiplying the Real APR by the throttle. For example if the real APR is 500% and the throttle is 20% then
the actual APR paid out will be 100%. To be more technically correct the APR paid out is the throttled value of the previous 48 epochs (24 hours) real APR.

This system means that the APR is still entirely driven by the market. If there is high demand then the profit that the protocol makes goes up and therefore the APR paid out also goes up. Ie if real APR yesterday was 500% and the real APR today is 1000% then the actually paid APR will go from 100% to 200% - increasing with the market demand.

Smoothing rewards in this way provides 2 pretty big advantages:
1. The APR is more predictable (but still isn't fixed)
2. The Reward Overflow is a new source of Implied Collateral for the system.
