# Focal vesting

The typical way vesting works is the vesting happens over some fixed period of time from the "start point". That start point in the case of LP rewards in Malt V1 was the moment the profit was created and allocated to LP rewards. This results in a web of things to keep track of as there are many offset but overlapping vesting schedules running (1 for each reward creation) - all of which contribute to the currently earned reward for a given LP.

The new system developed is something we call "Focal Vesting". This is a process where there are fixed "focal points" where all rewards created in a given time period vest towards, regardless of where in the period the reward was created. This means some rewards will vest over slightly different periods but the end result is a much simpler system.

For example, choosing a focal length of 24 hours means any reward created between time 0 and time 24 hours will vest 1 focal length later (24 hours after the 24 hour mark = 48 hours). This means rewards created in the first block of hour 1 vest over 48 hours and rewards generated in the final block of hour 24 will vest over 24 hours instead. Any reward generated after the first 24 hours are now into the next focal period and will vest at the second focal point (at 72 hours).

![Focal Vesting](https://raw.githubusercontent.com/code-423n4/2021-11-malt/main/assets/focal_vesting.jpeg)

![Focal vesting](https://raw.githubusercontent.com/code-423n4/2021-11-malt/main/assets/focal_vesting2.jpeg)
