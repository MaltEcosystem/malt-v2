# Focal Vesting

Malt LP rewards vest over some period of time. But what is that period of time? Unlike other vesting systems the vesting period is not fixed. Instead what is fixed are check points for vesting. We call these check points focal points.

All rewards generated in a certain period of time will vest towards the next focal point. At launch the "focal length" is 48 hours. This means that the longest you can wait to vest your rewards is 48 hours. 

We also overlap the focal periods such that the minimum vesting length on any rewards is 24 hours. The start of the next focal period is when the current focal period is 50% complete. This means that if we are 24 hours into Focal 1 then Focal 2 will start (despite there being 24 hours left to go on Focal 1). Focal 1 now continues to vest its rewards but no new rewards are generated into that focal period. All new rewards go into Focal 2 which has 48 hours left.

So if rewards are generated at the vest start of a focal period you will have to wait 48 hours and if they are created 50% (24 hours) into the period it will vest over 24 hours. However if it comes 51% into the period then it will actually go into the next focal point instead and vest over 48 hours.

This is what creates a maximum vesting length of 48 hours and a minimum of 24 hours.
