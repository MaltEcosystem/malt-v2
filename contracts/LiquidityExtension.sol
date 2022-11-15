// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import './libraries/uniswap/Babylonian.sol';

import "./Permissions.sol";
import "./interfaces/IAuction.sol";
import "./interfaces/IDexHandler.sol";
import "./interfaces/IMaltDataLab.sol";
import "./interfaces/IBurnMintableERC20.sol";


/// @title Liquidity Extension
/// @author 0xScotch <scotch@malt.money>
/// @notice In charge of facilitating a premium with net supply contraction during auctions
contract LiquidityExtension is Permissions {
  using SafeERC20 for ERC20;

  ERC20 public collateralToken;
  IBurnMintableERC20 public malt;
  IAuction public auction;
  IDexHandler public dexHandler;
  IMaltDataLab public maltDataLab;

  uint256 public minReserveRatioBps = 4000; // 40%

  event SetAuction(address auction);
  event SetDexHandler(address dexHandler);
  event SetMaltDataLab(address dataLab);
  event SetMinReserveRatio(uint256 ratio);
  event BurnMalt(uint256 purchased);

  constructor(
    address _timelock,
    address initialAdmin,
    address _auction,
    address _collateralToken,
    address _malt,
    address _dexHandler,
    address _maltDataLab
  ) {
    require(_timelock != address(0), "LE: Timelock addr(0)");
    require(initialAdmin != address(0), "LE: Admin addr(0)");
    require(_auction != address(0), "LE: Auction addr(0)");
    require(_maltDataLab != address(0), "LE: DataLab addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);
    _setupRole(AUCTION_ROLE, _auction);

    if (_dexHandler != address(0)) {
      dexHandler = IDexHandler(_dexHandler);
    }

    auction = IAuction(_auction);
    maltDataLab = IMaltDataLab(_maltDataLab);
    malt = IBurnMintableERC20(_malt);
    collateralToken = ERC20(_collateralToken);
  }

  /*
   * PUBLIC VIEW METHODS
   */
  function hasMinimumReserves() public view returns (bool) {
    (uint256 rRatio, uint256 decimals) = reserveRatio();
    return rRatio >= minReserveRatioBps * (10**decimals) / 10000;
  }

  function collateralDeficit() public view returns (uint256 deficit, uint256 decimals) {
    // Returns the amount of collateral token required to reach minimum reserves
    // Returns 0 if liquidity extension contains minimum reserves.
    uint256 balance = collateralToken.balanceOf(address(this));
    uint256 collateralDecimals = collateralToken.decimals();

    uint256 k = maltDataLab.smoothedK();

    if (k == 0) {
      (k,) = maltDataLab.lastK();
      if (k == 0) {
        return (0, collateralDecimals);
      }
    }

    uint256 priceTarget = maltDataLab.priceTarget();

    uint256 fullCollateral = Babylonian.sqrt(
      k * (10**collateralDecimals) / priceTarget
    );

    uint256 minReserves = fullCollateral * minReserveRatioBps / 10000;

    if (minReserves > balance) {
      return (minReserves - balance, collateralDecimals);
    }

    return (0, collateralDecimals);
  }

  function reserveRatio() public view returns (uint256, uint256) {
    uint256 balance = collateralToken.balanceOf(address(this));
    uint256 collateralDecimals = collateralToken.decimals();

    uint256 k = maltDataLab.smoothedK();

    if (k == 0) {
      return (0, collateralDecimals);
    }

    uint256 priceTarget = maltDataLab.priceTarget();

    uint256 fullCollateral = Babylonian.sqrt(
      k * (10**collateralDecimals) / priceTarget
    );

    uint256 rRatio = balance * (10**collateralDecimals) / fullCollateral;
    return (rRatio, collateralDecimals);
  }

  function reserveRatioAverage(uint256 lookback) public view returns (uint256, uint256) {
    uint256 balance = collateralToken.balanceOf(address(this));
    uint256 collateralDecimals = collateralToken.decimals();

    uint256 k = maltDataLab.kAverage(lookback);
    uint256 priceTarget = maltDataLab.priceTarget();

    uint256 fullCollateral = Babylonian.sqrt(
      k * (10**collateralDecimals) / priceTarget
    );

    uint256 rRatio = balance * (10**collateralDecimals) / fullCollateral;
    return (rRatio, collateralDecimals);
  }

  /*
   * PRIVILEDGED METHODS
   */
  function purchaseAndBurn(uint256 amount)
    external
    onlyRoleMalt(AUCTION_ROLE, "Must have auction privs")
    returns (uint256 purchased)
  {
    require(collateralToken.balanceOf(address(this)) >= amount, "LE: Insufficient balance");
    collateralToken.safeTransfer(address(dexHandler), amount);
    purchased = dexHandler.buyMalt(amount, 10000); // 100% allowable slippage
    malt.burn(address(this), purchased);

    emit BurnMalt(purchased);
  }

  function setAuction(address _auction)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_auction != address(0), "Not address 0");
    auction = IAuction(_auction);
    emit SetAuction(_auction);
  }

  function setDexHandler(address _dexHandler)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_dexHandler != address(0), "Not address 0");
    dexHandler = IDexHandler(_dexHandler);
    emit SetDexHandler(_dexHandler);
  }

  function setMaltDataLab(address _dataLab)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_dataLab != address(0), "Not address 0");
    maltDataLab = IMaltDataLab(_dataLab);
    emit SetMaltDataLab(_dataLab);
  }

  function setMinReserveRatio(uint256 _ratio)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_ratio != 0 && _ratio <= 10000, "Must be between 0 and 100");
    minReserveRatioBps = _ratio;
    emit SetMinReserveRatio(_ratio);
  }
}
