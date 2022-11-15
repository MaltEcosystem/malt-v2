# Epochs

Many stablecoins surface the epoch to the end user and actions like expanding the supply when TWAP is over peg only happen at the start of a new epoch. This slows down the speed with which the protocol can react to changes in demand. Malt wanted to avoid this rigid approach to epochs and stabilizing actions. As such all stabilization actions can occur at any point regardless of where it falls in an epoch.

However, Malt still has epochs internally. They are used as an accounting device for the protocol. The core reason they are used is to track when a participant bonded their LP to know what rewards they are entitled to.

If a user bonds in epoch 38 they will start earning rewards on any profit generated during epoch 39 and beyond. Due to this a user may have to wait an entire epoch \(30mins\) to start earning rewards if they bonded their LP at the very start of an epoch.

Epochs are also used to determine the period of time rewards get released to a user. The rewards allocated to a user will stream to them every block over the course of 48 epochs \(24 hours\) after they are allocated to them.

For example as user bonds in epoch 38 and during epoch 39 they are allocated $100 of rewards. That $100 will stream to them linearly over the course of 48 epochs and will therefore be fully withdrawable at epoch 87. If they also got allocated $100 during epoch 40 then that will only be fully withdrawable at epoch 88. Therefore at the start of epoch 87 all of the epoch 39 reward is withdrawable and 47/48 of the epoch 40 rewards will be withdrawable.

