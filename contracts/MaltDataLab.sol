// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/IStabilizerNode.sol";
import "./interfaces/IMovingAverage.sol";
import "./interfaces/IDualMovingAverage.sol";
import "./interfaces/IDAO.sol";
import "./interfaces/IBurnMintableERC20.sol";
import "./interfaces/ILiquidityExtension.sol";

import "./libraries/uniswap/IUniswapV2Pair.sol";
import "./libraries/SafeBurnMintableERC20.sol";
import "./libraries/uniswap/FixedPoint.sol";

import "./Permissions.sol";


/// @title Malt Data Lab
/// @author 0xScotch <scotch@malt.money>
/// @notice The central source of all of Malt protocol's internal data needs
/// @dev Over time usage of MovingAverage will likely be replaced with more reliable oracles
contract MaltDataLab is Permissions {
  using FixedPoint for *;
  using SafeBurnMintableERC20 for IBurnMintableERC20;

  bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

  IBurnMintableERC20 public rewardToken;
  IBurnMintableERC20 public malt;
  IUniswapV2Pair public stakeToken;

  // The dual values will be the pool price and the square root of the invariant k
  IDualMovingAverage public poolMA;

  uint256 public priceTarget = 10**18; // $1
  uint256 public maltPriceLookback = 10 minutes;
  uint256 public reserveLookback = 15 minutes;
  uint256 public kLookback = 30 minutes;

  uint256 public maltPriceCumulativeLast;
  uint256 public maltPriceTimestampLast;

  event TrackPool(uint256 price, uint256 rootK);

  constructor(
    address _timelock,
    address initialAdmin,
    address _malt,
    address _rewardToken,
    address _stakeToken,
    uint256 _priceTarget,
    address _poolMA
  ) {
    require(_timelock != address(0), "DataLab: Timelock addr(0)");
    require(initialAdmin != address(0), "DataLab: Admin addr(0)");
    require(_malt != address(0), "DataLab: Malt addr(0)");
    require(_rewardToken != address(0), "DataLab: RewardToken addr(0)");
    require(_stakeToken != address(0), "DataLab: lpToken addr(0)");
    require(_poolMA != address(0), "DataLab: PoolMA addr(0)");
    _adminSetup(_timelock);
    _setupRole(ADMIN_ROLE, initialAdmin);

    _setRoleAdmin(UPDATER_ROLE, ADMIN_ROLE);

    stakeToken = IUniswapV2Pair(_stakeToken);
    malt = IBurnMintableERC20(_malt);
    rewardToken = IBurnMintableERC20(_rewardToken);
    priceTarget = _priceTarget;
    poolMA = IDualMovingAverage(_poolMA);
  }

  function smoothedMaltPrice() public view returns (uint256 price) {
    (price,) = poolMA.getValueWithLookback(maltPriceLookback);
  }

  function smoothedK() public view returns (uint256) {
    (, uint256 rootK) = poolMA.getValueWithLookback(kLookback);
    return rootK * rootK;
  }

  function smoothedReserves() public view returns (uint256 maltReserves, uint256 collateralReserves) {
    // Malt reserves = sqrt(k / malt price)
    (uint256 price, uint256 rootK) = poolMA.getValueWithLookback(reserveLookback);
    uint256 unity = 10**rewardToken.decimals();

    // maltReserves = sqrt(k * 1 / price);
    maltReserves = Babylonian.sqrt(rootK * rootK * unity / price);
    collateralReserves = maltReserves * price / unity;
  }

  function maltPriceAverage(uint256 _lookback) public view returns (uint256 price) {
    (price,) = poolMA.getValueWithLookback(_lookback);
  }

  function kAverage(uint256 _lookback) public view returns (uint256) {
    (, uint256 rootK) = poolMA.getValueWithLookback(_lookback);
    return rootK * rootK;
  }

  function poolReservesAverage(uint256 _lookback) public view returns (uint256 maltReserves, uint256 collateralReserves) {
    // Malt reserves = sqrt(k / malt price)
    (uint256 price, uint256 rootK) = poolMA.getValueWithLookback(_lookback);

    uint256 unity = 10**rewardToken.decimals();

    // maltReserves = sqrt(k * 1 / price);
    maltReserves = Babylonian.sqrt(rootK * rootK * unity / price);
    collateralReserves = maltReserves * price / unity;
  }

  function lastMaltPrice() public view returns (uint256 price, uint64 timestamp) {
    (timestamp,,,,,price,) = poolMA.getLiveSample();
  }

  function lastPoolReserves() public view returns (
    uint256 maltReserves,
    uint256 collateralReserves,
    uint64 timestamp
  ) {
    // Malt reserves = sqrt(k / malt price)
    (
      uint64 timestamp,
      ,,,,
      uint256 price,
      uint256 rootK
    ) = poolMA.getLiveSample();

    uint256 unity = 10**rewardToken.decimals();

    // maltReserves = sqrt(k * 1 / price);
    maltReserves = Babylonian.sqrt(rootK * rootK * unity / price);
    collateralReserves = maltReserves * price / unity;
  }

  function lastK() public view returns (
    uint256 kLast,
    uint64 timestamp
  ) {
    // Malt reserves = sqrt(k / malt price)
    (
      uint64 timestamp,
      ,,,,,
      uint256 rootK
    ) = poolMA.getLiveSample();

    kLast = rootK * rootK;
  }

  function realValueOfLPToken(uint256 amount) external view returns (uint256) {
    (uint256 maltPrice, uint256 rootK) = poolMA.getValueWithLookback(reserveLookback);

    uint256 unity = 10**rewardToken.decimals();

    // maltReserves = sqrt(k * 1 / price);
    uint256 maltReserves = Babylonian.sqrt(rootK * rootK * unity / maltPrice);
    uint256 collateralReserves = maltReserves * maltPrice / unity;

    if (maltReserves == 0) {
      return 0;
    }

    uint256 totalLPSupply = stakeToken.totalSupply();

    uint256 maltValue = amount * maltReserves / totalLPSupply;
    uint256 rewardValue = amount * collateralReserves / totalLPSupply;

    return rewardValue + (maltValue * maltPrice / unity);
  }

  /*
   * Public mutation methods
   */
  function trackPool() external {
    (
      uint256 reserve0,
      uint256 reserve1,
      uint32 blockTimestampLast
    ) = stakeToken.getReserves();

    if (blockTimestampLast < maltPriceTimestampLast) {
      // stale data
      return;
    }

    uint256 kLast = reserve0 * reserve1;

    uint256 rootK = Babylonian.sqrt(kLast);

    uint256 price;
    uint256 priceCumulative;

    if (address(malt) < address(rewardToken)) {
      priceCumulative = stakeToken.price0CumulativeLast();
    } else {
      priceCumulative = stakeToken.price1CumulativeLast();
    }

    if (blockTimestampLast > maltPriceTimestampLast && maltPriceCumulativeLast != 0) {
      price = FixedPoint.uq112x112(uint224(
        (priceCumulative - maltPriceCumulativeLast) / (blockTimestampLast - maltPriceTimestampLast)
      )).mul(priceTarget).decode144();
    } else if (maltPriceCumulativeLast > 0 && priceCumulative == maltPriceCumulativeLast) {
      (,,,,,price,) = poolMA.getLiveSample();
    }

    if (price != 0) {
      // Use rootK to slow down growth of cumulativeValue
      poolMA.update(price, rootK);
      emit TrackPool(price, rootK);
    }

    maltPriceCumulativeLast = priceCumulative;
    maltPriceTimestampLast = blockTimestampLast;
  }

  /*
   * PRIVILEDGED METHODS
   */
  function trustedTrackPool(uint256 price, uint256 rootK, uint256 priceCumulative)
    external
    onlyRoleMalt(UPDATER_ROLE, "Must have updater role")
  {
    require(priceCumulative >= maltPriceCumulativeLast, "trustedTrackPool: priceCumulative");

    if (price != 0) {
      poolMA.update(price, rootK);
      emit TrackPool(price, rootK);
    }

    maltPriceCumulativeLast = priceCumulative;
    maltPriceTimestampLast = block.timestamp;
  }

  function setPriceTarget(uint256 _price)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_price > 0, "Cannot have 0 price");
    priceTarget = _price;
  }

  function setMaltPriceLookback(uint256 _lookback)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_lookback > 0, "Cannot have 0 lookback");
    maltPriceLookback = _lookback;
  }

  function setReserveLookback(uint256 _lookback)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_lookback > 0, "Cannot have 0 lookback");
    reserveLookback = _lookback;
  }

  function setKLookback(uint256 _lookback)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_lookback > 0, "Cannot have 0 lookback");    kLookback = _lookback;
  }

  function setMaltPoolAverageContract(address _poolMA)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_poolMA != address(0), "Cannot use 0 address");
    poolMA = IDualMovingAverage(_poolMA);
  }
}
