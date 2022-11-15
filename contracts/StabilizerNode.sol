// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Permissions.sol";
import "./interfaces/IAuction.sol";
import "./interfaces/IMaltDataLab.sol";
import "./interfaces/IDAO.sol";
import "./interfaces/IRewardThrottle.sol";
import "./interfaces/IAuctionBurnReserveSkew.sol";
import "./interfaces/ILiquidityExtension.sol";
import "./interfaces/IImpliedCollateralService.sol";
import "./interfaces/IDexHandler.sol";
import "./interfaces/ISwingTrader.sol";
import "./interfaces/IBurnMintableERC20.sol";
import "./interfaces/ISupplyDistributionController.sol";
import "./interfaces/IAuctionStartController.sol";


/// @title Stabilizer Node
/// @author 0xScotch <scotch@malt.money>
/// @notice The backbone of the Malt stability system. In charge of triggering actions to stabilize price
contract StabilizerNode is Permissions {
  using SafeERC20 for ERC20;

  uint256 internal stabilizeWindowEnd;
  uint256 public stabilizeBackoffPeriod = 5 * 60; // 5 minutes
  uint256 public upperStabilityThresholdBps = 100; // 1%
  uint256 public lowerStabilityThresholdBps = 100;
  uint256 public maxContributionBps = 7000;
  uint256 public priceAveragePeriod = 5 minutes;
  uint256 public fastAveragePeriod = 30; // 30 seconds
  uint256 public emergencyMintLookback = 5 minutes;
  uint256 public emergencyMintThresholdBps = 200; // 2%
  uint256 public overrideDistanceBps = 200; // 2%

  uint256 public expansionDampingFactor = 1;

  uint256 public defaultIncentive = 100; // in Malt
  uint256 public trackingIncentive = 20; // in 100ths of a Malt

  uint256 public daoRewardCutBps;
  uint256 public lpRewardCutBps = 4170;
  uint256 public auctionPoolRewardCutBps = 1130;
  uint256 public swingTraderRewardCutBps = 4170;
  uint256 public treasuryRewardCutBps = 500;
  uint256 public callerRewardCutBps = 30;

  uint256 public upperBandLimitBps = 100000; // 1000%
  uint256 public lowerBandLimitBps = 1000; // 10%
  uint256 public sampleSlippageBps = 2000; // 20%
  uint256 public skipAuctionThreshold;

  uint256 public lastStabilize;
  uint256 public lastTracking;
  uint256 public trackingBackoff = 30; // 30 seconds

  bool internal trackAfterStabilize = true;

  ERC20 public rewardToken;
  IBurnMintableERC20 public malt;
  IAuction public auction;
  IDexHandler public dexHandler;
  IDAO public dao;
  ILiquidityExtension public liquidityExtension;
  IMaltDataLab public maltDataLab;
  IAuctionBurnReserveSkew public auctionBurnReserveSkew;
  IRewardThrottle public rewardThrottle;
  ISwingTrader public swingTrader;
  IImpliedCollateralService public impliedCollateralService;

  address payable public treasuryMultisig;
  address public auctionPool;
  address public supplyDistributionController;
  address public auctionStartController;

  event MintMalt(uint256 amount);
  event Stabilize(uint256 timestamp, uint256 exchangeRate);
  event RewardDistribution(uint256 rewarded);
  event SetStabilizeBackoff(uint256 period);
  event SetAuctionBurnSkew(address auctionBurnReserveSkew);
  event SetRewardCut(uint256 daoCut, uint256 lpCut, uint256 callerCut, uint256 treasuryCut, uint256 auctionPoolCut, uint256 swingTraderCut);
  event SetTreasury(address newTreasury);
  event SetDefaultIncentive(uint256 incentive);
  event SetTrackingIncentive(uint256 incentive);
  event SetExpansionDamping(uint256 amount);
  event SetNewMaltDataLab(address dataLab);
  event SetAuctionContract(address auction);
  event SetDexHandler(address dexHandler);
  event SetDao(address dao);
  event SetLiquidityExtension(address liquidityExtension);
  event SetRewardThrottle(address rewardThrottle);
  event SetSwingTrader(address swingTrader);
  event SetPriceAveragePeriod(uint256 period);
  event SetOverrideDistance(uint256 distance);
  event SetFastAveragePeriod(uint256 period);
  event SetStabilityThresholds(uint256 upper, uint256 lower);
  event SetAuctionPool(address auctionPool);
  event SetMaxContribution(uint256 maxContribution);
  event SetImpliedCollateralService(address impliedCollateralService);
  event SetSupplyDistributionController(address _controller);
  event SetAuctionStartController(address _controller);
  event SetBandLimits(uint256 _upper, uint256 _lower);
  event SetSlippageBps(uint256 _slippageBps);
  event SetSkipAuctionThreshold(uint256 _skipAuctionThreshold);
  event SetEmergencyMintThresholdBps(uint256 thresholdBps);
  event SetEmergencyMintLookback(uint256 lookback);
  event Tracking();
  event SetTrackingBackoff(uint256 backoff);

  constructor(
    address _timelock,
    address initialAdmin,
    address _malt,
    address _rewardToken,
    address payable _treasuryMultisig,
    uint256 _skipAuctionThreshold
  ) {
    require(_timelock != address(0), "StabilizerNode: Timelock addr(0)");
    require(initialAdmin != address(0), "StabilizerNode: Admin addr(0)");
    require(_treasuryMultisig != address(0), "StabilizerNode: Treasury addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);

    treasuryMultisig = _treasuryMultisig;
    rewardToken = ERC20(_rewardToken);
    malt = IBurnMintableERC20(_malt);
    skipAuctionThreshold = _skipAuctionThreshold;

    lastStabilize = block.timestamp;
  }

  function setupContracts(
    address _dexHandler,
    address _maltDataLab,
    address _auctionBurnReserveSkew,
    address _rewardThrottle,
    address _dao,
    address _swingTrader,
    address _liquidityExtension,
    address _impliedCollateralService,
    address _auction,
    address _auctionPool
  ) external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(auctionPool == address(0), "StabilizerNode: Already setup");
    require(_dexHandler != address(0), "StabilizerNode: DexHandler addr(0)");
    require(_maltDataLab != address(0), "StabilizerNode: DataLab addr(0)");
    require(_auctionBurnReserveSkew != address(0), "StabilizerNode: BurnSkew addr(0)");
    require(_rewardThrottle != address(0), "StabilizerNode: Throttle addr(0)");
    require(_dao != address(0), "StabilizerNode: DAO addr(0)");
    require(_swingTrader != address(0), "StabilizerNode: Swing addr(0)");
    require(_liquidityExtension != address(0), "StabilizerNode: LE addr(0)");
    require(_impliedCollateralService != address(0), "StabilizerNode: ImpCol addr(0)");
    require(_auction != address(0), "StabilizerNode: Auction addr(0)");
    require(_auctionPool != address(0), "StabilizerNode: AuctionPool addr(0)");

    _setupRole(AUCTION_ROLE, _auction);

    dexHandler = IDexHandler(_dexHandler);
    maltDataLab = IMaltDataLab(_maltDataLab);
    auctionBurnReserveSkew = IAuctionBurnReserveSkew(_auctionBurnReserveSkew);
    rewardThrottle = IRewardThrottle(_rewardThrottle);
    dao = IDAO(_dao);
    swingTrader = ISwingTrader(_swingTrader);
    liquidityExtension = ILiquidityExtension(_liquidityExtension);
    impliedCollateralService = IImpliedCollateralService(_impliedCollateralService);
    auction = IAuction(_auction);
    auctionPool = _auctionPool;
  }

  function stabilize() external nonReentrant onlyEOA() {
    // Ensure data consistency
    maltDataLab.trackPool();

    // Finalize auction if possible before potentially starting a new one
    auction.checkAuctionFinalization();

    require(
      block.timestamp >= stabilizeWindowEnd || _stabilityWindowOverride(),
      "Can't call stabilize"
    );
    stabilizeWindowEnd = block.timestamp + stabilizeBackoffPeriod;

    rewardThrottle.checkRewardUnderflow();

    // used in 3 location.
    uint256 exchangeRate = maltDataLab.maltPriceAverage(priceAveragePeriod);

    if (!_shouldAdjustSupply(exchangeRate)) {
      lastStabilize = block.timestamp;
      return;
    }

    emit Stabilize(block.timestamp, exchangeRate);

    (uint256 livePrice,) = dexHandler.maltMarketPrice();

    uint256 priceTarget = maltDataLab.priceTarget();
    // The upper and lower bands here avoid any issues with price
    // descrepency between the TWAP and live market price.
    // This avoids starting auctions too quickly into a big selloff
    // and also reduces risk of flashloan vectors
    if (exchangeRate > priceTarget) {
      uint256 upperBand = exchangeRate + (exchangeRate * upperBandLimitBps / 10000);
      uint256 latestSample = maltDataLab.maltPriceAverage(0);
      uint256 minThreshold = latestSample - ((latestSample - priceTarget) * sampleSlippageBps / 10000);

      if (!hasRole(ADMIN_ROLE, _msgSender())) {
        require(livePrice < upperBand, "Stabilize: Beyond upper bound");
        require(livePrice > minThreshold, "Stabilize: Slippage threshold");
      }

      _distributeSupply();
    } else {
      uint256 lowerBand = exchangeRate - (exchangeRate * lowerBandLimitBps / 10000);
      require(livePrice > lowerBand, "Stabilize: Beyond lower bound");

      _startAuction();
    }

    if (trackAfterStabilize) {
      maltDataLab.trackPool();
    }
    lastStabilize = block.timestamp;
  }

  function endAuctionEarly() external {
    // This call reverts if the auction isn't ended
    auction.endAuctionEarly();

    // It hasn't reverted so the auction was ended. Pay the incentive
    malt.mint(msg.sender, defaultIncentive * (10**malt.decimals()));
    emit MintMalt(defaultIncentive * (10**malt.decimals()) );
  }

  function trackPool() external {
    require(block.timestamp >= lastTracking + trackingBackoff, "Too early");
    maltDataLab.trackPool();
    malt.mint(msg.sender, (trackingIncentive * (10**malt.decimals())) / 100); // div 100 because units are cents
    lastTracking = block.timestamp;
    emit Tracking();
  }

  /*
   * INTERNAL VIEW FUNCTIONS
   */
  function _stabilityWindowOverride() internal view returns (bool) {
    if (hasRole(ADMIN_ROLE, _msgSender())) {
      // Admin can always stabilize
      return true;
    }
    // Must have elapsed at least one period of the moving average before we stabilize again
    if (block.timestamp < lastStabilize + fastAveragePeriod) {
      return false;
    }

    uint256 priceTarget = maltDataLab.priceTarget();
    uint256 exchangeRate = maltDataLab.maltPriceAverage(fastAveragePeriod);

    uint256 upperThreshold = priceTarget * (10000 + overrideDistanceBps) / 10000;

    return exchangeRate >= upperThreshold;
  }

  function _shouldAdjustSupply(uint256 exchangeRate) internal view returns (bool) {
    uint256 decimals = rewardToken.decimals();
    uint256 priceTarget = maltDataLab.priceTarget();

    uint256 upperThreshold = priceTarget * upperStabilityThresholdBps / 10000;
    uint256 lowerThreshold = priceTarget * lowerStabilityThresholdBps / 10000;

    return (exchangeRate <= (priceTarget - lowerThreshold) && !auction.auctionExists(auction.currentAuctionId())) || exchangeRate >= (priceTarget + upperThreshold);
  }

  /*
   * INTERNAL FUNCTIONS
   */
  function _distributeSupply() internal {
    if (supplyDistributionController != address(0)) {
      bool success = ISupplyDistributionController(supplyDistributionController).check();
      if (!success) {
        return;
      }
    }

    uint256 priceTarget = maltDataLab.priceTarget();
    uint256 tradeSize = dexHandler.calculateMintingTradeSize(priceTarget) / expansionDampingFactor;

    if (tradeSize == 0) {
      return;
    }

    uint256 swingAmount = swingTrader.sellMalt(tradeSize);

    if (swingAmount >= tradeSize) {
      return;
    }

    tradeSize = tradeSize - swingAmount;

    malt.mint(address(dexHandler), tradeSize);
    emit MintMalt(tradeSize);
    // Transfer verification ensure any attempt to
    // sandwhich will trigger stabilize first
    uint256 rewards = dexHandler.sellMalt(tradeSize, 10000);

    auctionBurnReserveSkew.addAbovePegObservation(tradeSize);

    uint256 remaining = _replenishLiquidityExtension(rewards);

    _distributeRewards(remaining);

    impliedCollateralService.claim();
  }

  function _distributeRewards(uint256 rewarded) internal {
    if (rewarded == 0) {
      return;
    }
    // Ensure starting at 0
    rewardToken.safeApprove(address(auction), 0);
    rewardToken.safeApprove(address(auction), rewarded);
    rewarded = auction.allocateArbRewards(rewarded);
    // Reset approval
    rewardToken.safeApprove(address(auction), 0);

    if (rewarded == 0) {
      return;
    }

    uint256 callerCut = rewarded * callerRewardCutBps / 10000;
    uint256 lpCut = rewarded * lpRewardCutBps / 10000;
    uint256 daoCut = rewarded * daoRewardCutBps / 10000;
    uint256 auctionPoolCut = rewarded * auctionPoolRewardCutBps / 10000;
    uint256 swingTraderCut = rewarded * swingTraderRewardCutBps / 10000;

    // Treasury gets paid after everyone else
    uint256 treasuryCut = rewarded - daoCut - lpCut - callerCut - auctionPoolCut - swingTraderCut;

    assert(treasuryCut <= rewarded);

    if (callerCut > 0) {
      rewardToken.safeTransfer(msg.sender, callerCut);
    }

    if (auctionPoolCut > 0) {
      rewardToken.safeTransfer(auctionPool, auctionPoolCut);
    }

    if (swingTraderCut > 0) {
      rewardToken.safeTransfer(address(swingTrader), swingTraderCut);
    }

    if (treasuryCut > 0) {
      rewardToken.safeTransfer(treasuryMultisig, treasuryCut);
    }

    if (daoCut > 0) {
      rewardToken.safeTransfer(address(dao), daoCut);
    }

    if (lpCut > 0) {
      rewardToken.safeTransfer(address(rewardThrottle), lpCut);
      rewardThrottle.handleReward();
    }

    emit RewardDistribution(rewarded);
  }

  function _replenishLiquidityExtension(uint256 rewards) internal returns (uint256 remaining) {
    if (rewards == 0) {
      return rewards;
    }

    (uint256 deficit,) = liquidityExtension.collateralDeficit();

    if (deficit == 0) {
      return rewards;
    }

    uint256 maxContrib = rewards * maxContributionBps / 10000;

    if (deficit >= maxContrib) {
      rewardToken.safeTransfer(address(liquidityExtension), maxContrib);
      return rewards - maxContrib;
    }

    rewardToken.safeTransfer(address(liquidityExtension), deficit);

    return rewards - deficit;
  }

  function _startAuction() internal {
    if (auctionStartController != address(0)) {
      bool success = IAuctionStartController(auctionStartController).checkForStart();
      if (!success) {
        return;
      }
    }

    uint256 priceTarget = maltDataLab.priceTarget();
    uint256 purchaseAmount = dexHandler.calculateBurningTradeSize(priceTarget);

    if (purchaseAmount < skipAuctionThreshold) {
      return;
    }

    purchaseAmount = purchaseAmount - (swingTrader.buyMalt(purchaseAmount));

    if (purchaseAmount < 10**rewardToken.decimals()) {
      return;
    }

    auction.triggerAuction(priceTarget, purchaseAmount);

    malt.mint(msg.sender, defaultIncentive * (10**malt.decimals()) );
    emit MintMalt(defaultIncentive * (10**malt.decimals()) );

    auctionBurnReserveSkew.addBelowPegObservation(purchaseAmount);
  }

  // @notice Allows minting of Malt for $1 in recovery mode
  // @param amount: Amount of rewardToken to use to mint Malt
  function emergencyMintMalt(uint256 amount) external {
    uint256 priceTarget = maltDataLab.priceTarget();

    // Setting emergency mint BPS to 0 always allows minting for $1
    // This should not be allowed generally but can be useful in edge case failures.
    if (emergencyMintThresholdBps != 0) {
      uint256 twap = maltDataLab.maltPriceAverage(emergencyMintLookback);
      uint256 target = priceTarget * (10000 - emergencyMintThresholdBps) / 10000;
      require(twap <= target, "Can only emergency mint below threshold");
    }

    rewardToken.safeTransferFrom(msg.sender, address(this), amount);
    uint256 unity = 10**rewardToken.decimals();

    rewardToken.safeTransfer(address(swingTrader), amount);
    malt.mint(msg.sender, amount * unity / priceTarget);
  }

  /*
   * PRIVILEDGED FUNCTIONS
   */

  function setStabilizeBackoff(uint256 _period)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_period > 0, "Must be greater than 0");
    stabilizeBackoffPeriod = _period;
    emit SetStabilizeBackoff(_period);
  }

  function setAuctionBurnSkew(address _auctionBurnReserveSkew)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    auctionBurnReserveSkew = IAuctionBurnReserveSkew(_auctionBurnReserveSkew);
    emit SetAuctionBurnSkew(_auctionBurnReserveSkew);
  }

  function setRewardCut(
    uint256 _daoCut,
    uint256 _lpCut,
    uint256 _callerCut,
    uint256 _auctionPoolCut,
    uint256 _swingTraderCut
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    uint256 sum = _daoCut + _lpCut + _callerCut + _auctionPoolCut + _swingTraderCut;
    require(sum <= 10000, "Reward cut must be <= 100%");
    daoRewardCutBps = _daoCut;
    lpRewardCutBps = _lpCut;
    callerRewardCutBps = _callerCut;
    auctionPoolRewardCutBps = _auctionPoolCut;
    swingTraderRewardCutBps = _swingTraderCut;
    uint256 treasuryCut = 10000 - sum;
    treasuryRewardCutBps = treasuryCut;

    emit SetRewardCut(_daoCut, _lpCut, _callerCut, treasuryCut, _auctionPoolCut, _swingTraderCut);
  }

  function setTreasury(address payable _newTreasury)
    external
    onlyRoleMalt(TIMELOCK_ROLE, "Must have timelock role")
  {
    treasuryMultisig = _newTreasury;
    emit SetTreasury(_newTreasury);
  }

  function setDefaultIncentive(uint256 _incentive)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_incentive != 0 && _incentive <= 1000, "Incentive out of range");

    defaultIncentive = _incentive;

    emit SetDefaultIncentive(_incentive);
  }

  function setTrackingIncentive(uint256 _incentive)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    // Priced in cents. Must be less than 1000 Malt
    require(_incentive != 0 && _incentive <= 100000, "Incentive out of range");

    trackingIncentive = _incentive;

    emit SetTrackingIncentive(_incentive);
  }

  /// @notice Only callable by Admin address.
  /// @dev Sets the Expansion Damping units.
  /// @param amount: Amount to set Expansion Damping units to.
  function setExpansionDamping(uint256 amount)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(amount > 0, "No negative damping");

    expansionDampingFactor = amount;
    emit SetExpansionDamping(amount);
  }

  function setNewDataLab(address _dataLab)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    maltDataLab = IMaltDataLab(_dataLab);
    emit SetNewMaltDataLab(_dataLab);
  }

  function setAuctionContract(address _auction)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {

    if (address(auction) != address(0)) {
      revokeRole(AUCTION_ROLE, address(auction));
    }

    auction = IAuction(_auction);
    _setupRole(AUCTION_ROLE, _auction);
    emit SetAuctionContract(_auction);
  }

  function setStabilityThresholds(uint256 _upper, uint256 _lower)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_upper != 0 && _lower != 0, "Must be above 0");
    require(_lower < 10000, "Lower to large");

    upperStabilityThresholdBps = _upper;
    lowerStabilityThresholdBps = _lower;
    emit SetStabilityThresholds(_upper, _lower);
  }

  function setAuctionPool(address _auctionPool)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_auctionPool != address(0), "Not address 0");

    auctionPool = _auctionPool;
    emit SetAuctionPool(_auctionPool);
  }

  function setSupplyDistributionController(address _controller)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    // This is allowed to be set to address(0) as its checked before calling methods on it
    supplyDistributionController = _controller;
    emit SetSupplyDistributionController(_controller);
  }

  function setAuctionStartController(address _controller)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privilege")
  {
    // This is allowed to be set to address(0) as its checked before calling methods on it
    auctionStartController = _controller;
    emit SetAuctionStartController(_controller);
  }

  function setMaxContribution(uint256 _maxContribution)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_maxContribution != 0 && _maxContribution <= 10000, "Must be between 0 and 100");

    maxContributionBps = _maxContribution;
    emit SetMaxContribution(_maxContribution);
  }

  function setDexHandler(address _dexHandler)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_dexHandler != address(0), "Not address 0");
    dexHandler = IDexHandler(_dexHandler);
    emit SetDexHandler(_dexHandler);
  }

  function setDao(address _dao)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_dao != address(0), "Not address 0");
    dao = IDAO(_dao);
    emit SetDao(_dao);
  }

  function setLiquidityExtension(address _liquidityExtension)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_liquidityExtension != address(0), "Not address 0");
    liquidityExtension = ILiquidityExtension(_liquidityExtension);
    emit SetLiquidityExtension(_liquidityExtension);
  }

  function setRewardThrottle(address _rewardThrottle)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_rewardThrottle != address(0), "Not address 0");
    rewardThrottle = IRewardThrottle(_rewardThrottle);
    emit SetRewardThrottle(_rewardThrottle);
  }

  function setSwingTrader(address _swingTrader)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_swingTrader != address(0), "Not address 0");
    swingTrader = ISwingTrader(_swingTrader);
    emit SetSwingTrader(_swingTrader);
  }

  function setImpliedCollateralService(address _impliedCollateralService)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_impliedCollateralService != address(0), "Not address 0");
    impliedCollateralService = IImpliedCollateralService(_impliedCollateralService);
    emit SetImpliedCollateralService(_impliedCollateralService);
  }

  function setPriceAveragePeriod(uint256 _period)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_period > 0, "Cannot have 0 period");
    priceAveragePeriod = _period;
    emit SetPriceAveragePeriod(_period);
  }

  function setOverrideDistance(uint256 _distance)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_distance != 0 && _distance < 10000, "Override must be between 0-100%");
    overrideDistanceBps = _distance;
    emit SetOverrideDistance(_distance);
  }

  function setFastAveragePeriod(uint256 _period)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_period > 0, "Cannot have 0 period");
    fastAveragePeriod = _period;
    emit SetFastAveragePeriod(_period);
  }

  function setBandLimits(uint256 _upper, uint256 _lower)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_upper != 0 && _lower != 0, "Cannot have 0 band limit");
    upperBandLimitBps = _upper;
    lowerBandLimitBps = _lower;
    emit SetBandLimits(_upper, _lower);
  }

  function setSlippageBps(uint256 _slippageBps)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_slippageBps <= 10000, "slippage: Must be <= 100%");
    sampleSlippageBps = _slippageBps;
    emit SetSlippageBps(_slippageBps);
  }

  function setSkipAuctionThreshold(uint256 _skipAuctionThreshold)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    skipAuctionThreshold = _skipAuctionThreshold;
    emit SetSkipAuctionThreshold(_skipAuctionThreshold);
  }

  function setEmergencyMintLookback(uint256 _lookback)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_lookback != 0, "Lookback cannot be 0");
    emergencyMintLookback = _lookback;
    emit SetEmergencyMintLookback(_lookback);
  }

  function setEmergencyMintThresholdBps(uint256 _thresholdBps)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_thresholdBps < 10000, "Cannot be above 100%");
    emergencyMintThresholdBps = _thresholdBps;
    emit SetEmergencyMintThresholdBps(_thresholdBps);
  }

  function setTrackingBackoff(uint256 _backoff)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_backoff != 0, "Cannot be 0");
    trackingBackoff = _backoff;
    emit SetTrackingBackoff(_backoff);
  }

  function setTrackAfterStabilize(bool _track)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    trackAfterStabilize = _track;
  }
}
