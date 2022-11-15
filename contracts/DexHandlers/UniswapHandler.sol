// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;


import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import '../libraries/uniswap/IUniswapV2Router02.sol';
import '../libraries/uniswap/Babylonian.sol';
import '../libraries/uniswap/FullMath.sol';

import "../Permissions.sol";
import "../libraries/UniswapV2Library.sol";
import "../interfaces/IDexHandler.sol";
import "../interfaces/IMaltDataLab.sol";
import "../libraries/uniswap/IUniswapV2Pair.sol";


/// @title Uniswap Interaction Handler
/// @author 0xScotch <scotch@malt.money>
/// @notice A simple contract to make interacting with UniswapV2 pools easier.
/// @notice The buyMalt method is locked down to avoid circumventing recovery mode
/// @dev Makes use of UniswapV2Router02. Would be more efficient to go direct
contract UniswapHandler is Permissions, IDexHandler {
  using SafeERC20 for ERC20;

  bytes32 public constant BUYER_ROLE = keccak256("BUYER_ROLE");
  bytes32 public constant SELLER_ROLE = keccak256("SELLER_ROLE");
  bytes32 public constant LIQUIDITY_ADDER_ROLE = keccak256("LIQUIDITY_ADDER_ROLE");
  bytes32 public constant LIQUIDITY_REMOVER_ROLE = keccak256("LIQUIDITY_REMOVER_ROLE");

  ERC20 public malt;
  ERC20 public rewardToken;
  IUniswapV2Pair public lpToken;
  IUniswapV2Router02 public router;
  IMaltDataLab public maltDataLab;

  uint256 internal immutable rewardDecimals;

  constructor(
    address _timelock,
    address initialAdmin,
    address _maltToken,
    address _rewardToken,
    address _lpToken,
    address _router,
    address _maltDataLab
  ) {
    require(_timelock != address(0), "DexHandler: Timelock addr(0)");
    require(initialAdmin != address(0), "DexHandler: Admin addr(0)");
    require(_maltToken != address(0), "DexHandler: Malt addr(0)");
    require(_rewardToken != address(0), "DexHandler: RewardToken addr(0)");
    require(_lpToken != address(0), "DexHandler: lpToken addr(0)");
    require(_router != address(0), "DexHandler: Router addr(0)");
    require(_maltDataLab != address(0), "DexHandler: DataLab addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);
    _setRoleAdmin(BUYER_ROLE, ADMIN_ROLE);
    _setRoleAdmin(SELLER_ROLE, ADMIN_ROLE);
    _setRoleAdmin(LIQUIDITY_ADDER_ROLE, ADMIN_ROLE);
    _setRoleAdmin(LIQUIDITY_REMOVER_ROLE, ADMIN_ROLE);

    malt = ERC20(_maltToken);
    rewardToken = ERC20(_rewardToken);
    router = IUniswapV2Router02(_router);

    rewardDecimals = rewardToken.decimals();

    lpToken = IUniswapV2Pair(_lpToken);
    maltDataLab = IMaltDataLab(_maltDataLab);
  }

  /*
   * PUBLIC VIEW FUNCTIONS
   */
  function calculateMintingTradeSize(uint256 priceTarget) external view returns (uint256) {
    return _calculateTradeSize(address(malt), address(rewardToken), priceTarget);
  }

  function calculateBurningTradeSize(uint256 priceTarget) external view returns (uint256) {
    return _calculateTradeSize(address(rewardToken), address(malt), priceTarget);
  }

  function reserves() public view returns (uint256 maltSupply, uint256 rewardSupply) {
    (uint256 reserve0, uint256 reserve1,) = lpToken.getReserves();
    (maltSupply, rewardSupply) = address(malt) < address(rewardToken) ? (reserve0, reserve1) : (reserve1, reserve0);
  }

  function maltMarketPrice() public view returns (uint256 price, uint256 decimals) {
    (uint256 reserve0, uint256 reserve1,) = lpToken.getReserves();
    (uint256 maltReserves, uint256 rewardReserves) = address(malt) < address(rewardToken) ? (reserve0, reserve1) : (reserve1, reserve0);

    if (maltReserves == 0 || rewardReserves == 0) {
      price = 0;
      decimals = 18;
      return (price, decimals);
    }

    uint256 maltDecimals = malt.decimals();

    if (rewardDecimals > maltDecimals) {
      uint256 diff = rewardDecimals - maltDecimals;
      price = rewardReserves * (10**rewardDecimals) / (maltReserves * (10**diff));
      decimals = rewardDecimals;
    } else if (rewardDecimals < maltDecimals) {
      uint256 diff = maltDecimals - rewardDecimals;
      price = rewardReserves * (10**rewardDecimals) / (maltReserves / (10**diff));
      decimals = rewardDecimals;
    } else {
      price = rewardReserves * (10**rewardDecimals) / maltReserves;
      decimals = rewardDecimals;
    }
  }

  function getOptimalLiquidity(address tokenA, address tokenB, uint256 liquidityB)
    external view returns (uint256 liquidityA)
  {
    (uint256 reserve0, uint256 reserve1,) = lpToken.getReserves();
    (uint256 reservesA, uint256 reservesB) = tokenA < tokenB ? (reserve0, reserve1) : (reserve1, reserve0);

    liquidityA = UniswapV2Library.quote(
      liquidityB,
      reservesB,
      reservesA
    );
  }

  /*
   * MUTATION FUNCTIONS
   */
  function buyMalt(uint256 amount, uint256 slippageBps)
    external
    onlyRoleMalt(BUYER_ROLE, "Must have buyer privs")
    returns (uint256 purchased)
  {
    require(amount <= rewardToken.balanceOf(address(this)), "buy: insufficient");

    if (amount == 0) {
      return 0;
    }

    // Just make sure starting from 0
    rewardToken.safeApprove(address(router), 0);
    rewardToken.safeApprove(address(router), amount);

    address[] memory path = new address[](2);
    path[0] = address(rewardToken);
    path[1] = address(malt);

    uint256 maltPrice = maltDataLab.maltPriceAverage(0);

    uint256 initialBalance = malt.balanceOf(address(this));

    router.swapExactTokensForTokens(
      amount,
      amount * (10**rewardDecimals) * (10000 - slippageBps) / maltPrice / 10000, // amountOutMin
      path,
      address(this),
      block.timestamp
    );

    // Reset approval
    rewardToken.safeApprove(address(router), 0);

    purchased = malt.balanceOf(address(this)) - initialBalance;
    malt.safeTransfer(msg.sender, purchased);
  }

  function sellMalt(uint256 amount, uint256 slippageBps)
    external
    onlyRoleMalt(SELLER_ROLE, "Must have seller privs")
    returns (uint256 rewards)
  {
    require(amount <= malt.balanceOf(address(this)), "sell: insufficient");

    if (amount == 0) {
      return 0;
    }

    // Just make sure starting from 0
    malt.safeApprove(address(router), 0);
    malt.safeApprove(address(router), amount);

    address[] memory path = new address[](2);
    path[0] = address(malt);
    path[1] = address(rewardToken);

    uint256 maltPrice = maltDataLab.maltPriceAverage(0);
    uint256 initialBalance = rewardToken.balanceOf(address(this));

    router.swapExactTokensForTokens(
      amount,
      amount * maltPrice * (10000 - slippageBps) / (10**rewardDecimals) / 10000, // amountOutMin
      path,
      address(this),
      block.timestamp
    );

    // Reset approval
    malt.safeApprove(address(router), 0);

    rewards = rewardToken.balanceOf(address(this)) - initialBalance;
    rewardToken.safeTransfer(msg.sender, rewards);
  }

  function addLiquidity(uint256 maltBalance, uint256 rewardBalance, uint256 slippageBps)
    external
    onlyRoleMalt(LIQUIDITY_ADDER_ROLE, "Must have liq add privs")
    returns (
      uint256 maltUsed,
      uint256 rewardUsed,
      uint256 liquidityCreated
    )
  {
    // Thid method assumes the caller does the required checks on token ratios etc
    uint256 initialMalt = malt.balanceOf(address(this));
    uint256 initialReward = rewardToken.balanceOf(address(this));

    require(maltBalance <= initialMalt, "Add liquidity: malt");
    require(rewardBalance <= initialReward, "Add liquidity: reward");

    if (maltBalance == 0 || rewardBalance == 0) {
      return (0, 0, 0);
    }

    (maltUsed, rewardUsed, liquidityCreated) = _executeAddLiquidity(maltBalance, rewardBalance, slippageBps);

    if (maltUsed < initialMalt) {
      malt.safeTransfer(msg.sender, initialMalt - maltUsed);
    }

    if (rewardUsed < initialReward) {
      rewardToken.safeTransfer(msg.sender, initialReward - rewardUsed);
    }
  }

  function removeLiquidity(uint256 liquidityBalance, uint256 slippageBps)
    external
    onlyRoleMalt(LIQUIDITY_REMOVER_ROLE, "Must have liq remove privs")
    returns (uint256 amountMalt, uint256 amountReward)
  {
    require(liquidityBalance <= lpToken.balanceOf(address(this)), "remove: Insufficient");

    if (liquidityBalance == 0) {
      return (0, 0);
    }

    (amountMalt, amountReward) = _executeRemoveLiquidity(liquidityBalance, slippageBps);

    if (amountMalt == 0 || amountReward == 0) {
      liquidityBalance = lpToken.balanceOf(address(this));
      ERC20(address(lpToken)).safeTransfer(msg.sender, liquidityBalance);
      return (amountMalt, amountReward);
    }
  }

  /*
   * INTERNAL METHODS
   */
  function _executeAddLiquidity(uint256 maltBalance, uint256 rewardBalance, uint256 slippageBps)
    internal
    returns(
      uint256 maltUsed,
      uint256 rewardUsed,
      uint256 liquidityCreated
  ) {
    // Make sure starting from 0
    rewardToken.safeApprove(address(router), 0);
    malt.safeApprove(address(router), 0);

    rewardToken.safeApprove(address(router), rewardBalance);
    malt.safeApprove(address(router), maltBalance);

    (maltUsed, rewardUsed, liquidityCreated) = router.addLiquidity(
      address(malt),
      address(rewardToken),
      maltBalance,
      rewardBalance,
      maltBalance * (10000 - slippageBps) / 10000,
      rewardBalance * (10000 - slippageBps) / 10000,
      msg.sender, // transfer LP tokens to sender
      block.timestamp
    );

    // Reset approval
    rewardToken.safeApprove(address(router), 0);
    malt.safeApprove(address(router), 0);
  }

  function _executeRemoveLiquidity(uint256 liquidityBalance, uint256 slippageBps) internal returns(uint256 amountMalt, uint256 amountReward) {
    uint256 totalLPSupply = lpToken.totalSupply();

    // Make sure starting from 0
    ERC20(address(lpToken)).safeApprove(address(router), 0);
    ERC20(address(lpToken)).safeApprove(address(router), liquidityBalance);

    (uint256 maltReserves, uint256 collateralReserves) = maltDataLab.poolReservesAverage(0);

    uint256 maltValue = maltReserves * liquidityBalance / totalLPSupply;
    uint256 collateralValue = collateralReserves * liquidityBalance / totalLPSupply;

    (amountMalt, amountReward) = router.removeLiquidity(
      address(malt),
      address(rewardToken),
      liquidityBalance,
      maltValue * (10000 - slippageBps) / 10000,
      collateralValue * (10000 - slippageBps) / 10000,
      address(this),
      block.timestamp
    );

    // Reset approval
    ERC20(address(lpToken)).safeApprove(address(router), 0);

    malt.safeTransfer(msg.sender, amountMalt);
    rewardToken.safeTransfer(msg.sender, amountReward);
  }


  /*
   * PRIVATE METHODS
   */
  function _calculateTradeSize(address sellToken, address buyToken, uint256 priceTarget) private view returns (uint256) {
    (uint256 sellReserves, uint256 invariant) = _getTradePoolData(sellToken, buyToken);

    uint256 buyBase = 10**uint256(ERC20(buyToken).decimals());

    uint256 leftSide = Babylonian.sqrt(
      FullMath.mulDiv(
        invariant * 1000,
        priceTarget,
        buyBase * buyBase * 997 / priceTarget
      )
    );

    uint256 rightSide = sellReserves * 1000 / 997;

    if (leftSide < rightSide) return 0;

    return leftSide - rightSide;
  }

  function _getTradePoolData(address sellToken, address buyToken)
    private view
    returns (
      uint256 sellReserves,
      uint256 invariant
    )
  {
    (uint256 reserve0, uint256 reserve1,) = lpToken.getReserves();
    sellReserves = sellToken < buyToken ? reserve0 : reserve1;

    invariant = reserve1 * reserve0;
  }
}
