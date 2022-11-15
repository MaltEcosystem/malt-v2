# Burn Or Grow

Now that the protocol has a choice whether to burn additional malt to realise a supply contraction or to improve the reserves there must be a way to determine what to do.

This part will likely be iterated on a lot and improved over time. However, the initial heuristic is this:

* Keep a track of how many of the last 10 stabilization events have been above or below peg.
* Keep a track of the average % towards fully subscribed the last 10 auctions have been. I.E sum total desired raised for last 10 auctions and divide by total user commitments.
* Define a value called skew

  skew = abovePegFrequency +2\(subscriptionFrequency\)3  

* Choose to burn usableExcess skew

This means if price has been mostly above peg and all of the most recent auctions have been fully subscribed then the maximum amount of burn should occur because there is a lot of confidence in the protocol.

On the flip side if the price has been under peg for the last 10 stabilization events and low auction participation then the protocol will prioritize increasing the reserves as it may need to step in to bolster the lack of confidence.

Most of the time the skew will be some value in between the extremes meaning some blend of burning additional Malt and improving the reserve ratio is settled on.

