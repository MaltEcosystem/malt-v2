// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Permissions.sol";
import "./interfaces/IAuction.sol";
import "./interfaces/IAuctionPool.sol";
import "./interfaces/IOverflow.sol";
import "./interfaces/IBurnMintableERC20.sol";
import "./interfaces/IRewardThrottle.sol";
import "./interfaces/ISwingTrader.sol";
import "./interfaces/ILiquidityExtension.sol";
import "./interfaces/IMaltDataLab.sol";


/// @title Implied Collateral Service
/// @author 0xScotch <scotch@malt.money>
/// @notice A contract that provides an abstraction above individual implied collateral sources
contract ImpliedCollateralService is Permissions {
  using SafeERC20 for ERC20;

  ERC20 public collateralToken;
  IBurnMintableERC20 public malt;
  IAuctionPool public auctionPool;
  IOverflow public rewardOverflow;
  ISwingTrader public swingTrader;
  ILiquidityExtension public liquidityExtension;
  IMaltDataLab public maltDataLab;

  event SetAuctionPool(address auctionPool);
  event SetRewardOverflow(address rewardOverflow);

  constructor(
    address _timelock,
    address initialAdmin,
    address _collateralToken,
    address _malt
  ) {
    require(_timelock != address(0), "ImpCol: Timelock addr(0)");
    require(initialAdmin != address(0), "ImpCol: Admin addr(0)");
    require(_collateralToken != address(0), "ImpCol: ColToken addr(0)");
    require(_malt != address(0), "ImpCol: Malt addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);

    collateralToken = ERC20(_collateralToken);
    malt = IBurnMintableERC20(_malt);
  }

  function setupContracts(
    address _auction,
    address _auctionPool,
    address _rewardOverflow,
    address _swingTrader,
    address _liquidityExtension,
    address _maltDataLab
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(address(auctionPool) == address(0), "ImpCol: Already setup");
    require(_auction != address(0), "ImpCol: Auction addr(0)");
    require(_auctionPool != address(0), "ImpCol: AuctionPool addr(0)");
    require(_rewardOverflow != address(0), "ImpCol: Overflow addr(0)");
    require(_swingTrader != address(0), "ImpCol: Swing addr(0)");
    require(_liquidityExtension != address(0), "ImpCol: LE addr(0)");
    require(_maltDataLab != address(0), "ImpCol: DataLab addr(0)");

    _setupRole(AUCTION_ROLE, _auction);

    auctionPool = IAuctionPool(_auctionPool);
    rewardOverflow = IOverflow(_rewardOverflow);
    swingTrader = ISwingTrader(_swingTrader);
    liquidityExtension = ILiquidityExtension(_liquidityExtension);
    maltDataLab = IMaltDataLab(_maltDataLab);
  }

  function handleDeficit(uint256 maxAmount) external onlyRoleMalt(AUCTION_ROLE, "Must have auction role privs") {
    if (maxAmount > 0) {
      maxAmount = auctionPool.purchaseArbitrageTokens(maxAmount);
    }

    if (maxAmount > 0) {
      maxAmount = rewardOverflow.purchaseArbitrageTokens(maxAmount);
    }
  }

  function claim() external nonReentrant {
    auctionPool.claim();
    rewardOverflow.claim();
  }

  function setAuctionPool(address _auctionPool)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_auctionPool != address(0), "Not 0 address");
    auctionPool = IAuctionPool(_auctionPool);
    emit SetAuctionPool(_auctionPool);
  }

  function setRewardOverflow(address _rewardOverflow)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_rewardOverflow != address(0), "Not 0 address");
    rewardOverflow = IOverflow(_rewardOverflow);
    emit SetRewardOverflow(_rewardOverflow);
  }

  function getCollateralValueInMalt() public view returns (uint256 collateral) {
    uint256 maltPrice = maltDataLab.smoothedMaltPrice();
    uint256 target = maltDataLab.priceTarget();

    uint256 auctionPoolBalance = collateralToken.balanceOf(address(auctionPool)) * target / maltPrice;
    uint256 overflowBalance = collateralToken.balanceOf(address(rewardOverflow)) * target / maltPrice;
    uint256 liquidityExtensionBalance = collateralToken.balanceOf(address(liquidityExtension)) * target / maltPrice;
    uint256 swingTraderBalance = collateralToken.balanceOf(address(swingTrader)) * target / maltPrice;
    uint256 swingTraderMaltBalance = malt.balanceOf(address(swingTrader));

    return auctionPoolBalance + overflowBalance + liquidityExtensionBalance + swingTraderBalance + swingTraderMaltBalance;
  }

  function totalUsefulCollateral() public view returns (uint256 collateral) {
    uint256 auctionPoolBalance = collateralToken.balanceOf(address(auctionPool));
    uint256 overflowBalance = collateralToken.balanceOf(address(rewardOverflow));
    uint256 liquidityExtensionBalance = collateralToken.balanceOf(address(liquidityExtension));
    uint256 swingTraderBalance = collateralToken.balanceOf(address(swingTrader));

    return auctionPoolBalance + overflowBalance + liquidityExtensionBalance + swingTraderBalance;
  }
}
