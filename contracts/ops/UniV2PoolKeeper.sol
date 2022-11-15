pragma solidity 0.8.11;

import "../libraries/uniswap/Babylonian.sol";
import "../libraries/uniswap/UniswapV2OracleLibrary.sol";
import "../libraries/uniswap/IUniswapV2Pair.sol";

import "../Permissions.sol";
import "../interfaces/IKeeperCompatibleInterface.sol";
import "../interfaces/IDistributor.sol";
import "../interfaces/IMaltDataLab.sol";
import "../interfaces/IDexHandler.sol";
import "../interfaces/IDAO.sol";
import "../interfaces/IRewardThrottle.sol";

/// @title Pool Keeper
/// @author 0xScotch <scotch@malt.money>
/// @notice A chainlink keeper compatible contract to upkeep a Malt pool
contract UniV2PoolKeeper is Permissions, IKeeperCompatibleInterface {
  bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

  IMaltDataLab public maltDataLab;
  IDexHandler public dexHandler;
  IDistributor public vestingDistributor;
  IDAO public maltDao;
  IRewardThrottle public rewardThrottle;

  bool public upkeepVesting = true;
  bool public upkeepTracking = true;

  uint256 public minInterval = 30;
  uint256 internal lastTimestamp;

  event SetMinInterval(uint256 interval);
  event SetUpkeepVesting(bool upkeepVesting);
  event SetUpkeepTracking(bool upkeepTracking);

  constructor(
    address _timelock,
    address initialAdmin,
    address _maltDataLab,
    address _vestingDistributor,
    address _dexHandler,
    address _dao,
    address _keeperRegistry,
    address _rewardThrottle
  ) {
    _adminSetup(_timelock);
    _setupRole(ADMIN_ROLE, initialAdmin);

    _roleSetup(KEEPER_ROLE, initialAdmin);
    _grantRole(KEEPER_ROLE, _keeperRegistry);

    maltDataLab = IMaltDataLab(_maltDataLab);
    vestingDistributor = IDistributor(_vestingDistributor);
    rewardThrottle = IRewardThrottle(_rewardThrottle);
    dexHandler = IDexHandler(_dexHandler);
    maltDao = IDAO(_dao);
  }

  function checkUpkeep(bytes calldata /* checkData */)
    external
    view
    override
    returns (bool upkeepNeeded, bytes memory performData)
  {
    uint256 currentEpoch = maltDao.epoch();

    uint256 nextEpochStart = maltDao.getEpochStartTime(currentEpoch + 1);

    bool shouldAdvance = block.timestamp >= nextEpochStart;

    (
      uint256 price,
      uint256 rootK,
      uint256 priceCumulative
    ) = _getPoolState();

    performData = abi.encode(
      shouldAdvance,
      upkeepVesting,
      upkeepTracking,
      price,
      rootK,
      priceCumulative
    );
    upkeepNeeded = (block.timestamp - lastTimestamp) > minInterval;
  }

  function _getPoolState()
    internal
    view
    returns(
      uint256,
      uint256,
      uint256
    )
  {
    address rewardToken = maltDataLab.rewardToken();
    address malt = maltDataLab.malt();
    address stakeToken = maltDataLab.stakeToken();

    (
      uint256 reserve0,
      uint256 reserve1,
    ) = IUniswapV2Pair(stakeToken).getReserves();

    uint256 kLast = reserve0 * reserve1;
    uint256 rootK = Babylonian.sqrt(kLast);

    (
      uint256 price0Cumulative,
      uint256 price1Cumulative,
    ) = UniswapV2OracleLibrary.currentCumulativePrices(stakeToken);

    (
      uint256 price,
    ) = dexHandler.maltMarketPrice();

    uint256 priceCumulative =
      malt < rewardToken ? price0Cumulative : price1Cumulative;

    return (
      price,
      rootK,
      priceCumulative
    );
  }

  function performUpkeep(bytes calldata performData)
    external
    onlyRoleMalt(KEEPER_ROLE, "Must have keeper role")
  {
    (
      bool shouldAdvance,
      bool shouldVest,
      bool shouldTrackPool,
      uint256 price,
      uint256 rootK,
      uint256 priceCumulative
    ) = abi.decode(performData, (bool, bool, bool, uint256, uint256, uint256));

    if (shouldVest) {
      vestingDistributor.vest();
    }

    if (shouldTrackPool) {
      // This keeper should be whitelisted to make updates
      maltDataLab.trustedTrackPool(price, rootK, priceCumulative);
    }

    if (shouldAdvance) {
      maltDao.advance();
    }

    rewardThrottle.checkRewardUnderflow();

    lastTimestamp = block.timestamp;
  }

  function setMaltDataLab(address _maltDataLab)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_maltDataLab != address(0), "Cannot use 0 address");
    maltDataLab = IMaltDataLab(_maltDataLab);
  }

  function setVestingDistributor(address _distributor)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_distributor != address(0), "Cannot use 0 address");
    vestingDistributor = IDistributor(_distributor);
  }

  function setDexHandler(address _dexHandler)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_dexHandler != address(0), "Cannot use 0 address");
    dexHandler = IDexHandler(_dexHandler);
  }

  function setMaltDao(address _dao)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_dao != address(0), "Cannot use 0 address");
    maltDao = IDAO(_dao);
  }

  function setRewardThrottle(address _rewardThrottle)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_rewardThrottle != address(0), "Cannot use 0 address");
    rewardThrottle = IRewardThrottle(_rewardThrottle);
  }

  function setMinInterval(uint256 _interval)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    minInterval = _interval;
    emit SetMinInterval(_interval);
  }

  function setUpkeepVesting(bool _upkeepVesting)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    upkeepVesting = _upkeepVesting;
    emit SetUpkeepVesting(_upkeepVesting);
  }

  function setUpkeepTracking(bool _upkeepTracking)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    upkeepTracking = _upkeepTracking;
    emit SetUpkeepTracking(_upkeepTracking);
  }
}
