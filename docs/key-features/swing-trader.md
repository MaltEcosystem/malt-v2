# Swing Trader

The Swing Trader is a contract that tries to make profit from the price swings in Malt. As it makes profit it increases the implied collateral in the system as the swing trader balance is part of the implied collateral.

Part of the profit made by the Swing Trader is also given to LPs as rewards. This plays into the "democratizing arb bots" idea that we feel so strongly about.

There isn't much complicated about the Swing Trader. It is a contract that tries to buy Malt for cheap and sell it higher. Specifically it purchases Malt when the price drops below the peg and sells it when the price is above peg.

The Swing Trader is smart and has a system that will avoid buying when the price is dropping quickly. There is no need to start buying when there is a firehose of selling right now. The Swing Trader will wait for the selling to slow down and the price to settle in before it looks for an entry to swing the price back to peg.
