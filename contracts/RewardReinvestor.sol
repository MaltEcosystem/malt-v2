// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IDexHandler.sol";
import "./interfaces/IBonding.sol";
import "./interfaces/IMiningService.sol";
import './libraries/uniswap/Babylonian.sol';
import "./libraries/UniswapV2Library.sol";
import "./Permissions.sol";


/// @title Reward Reinvestor
/// @author 0xScotch <scotch@malt.money>
/// @notice Provide a way to programmatically reinvest Malt rewards
contract RewardReinvestor is Permissions {
  using SafeERC20 for ERC20;

  ERC20 public malt;
  ERC20 public rewardToken;
  ERC20 public stakeToken;

  IDexHandler public dexHandler;
  IBonding public bonding;
  IMiningService public miningService;
  address public treasury;

  event ProvideReinvest(address account, uint256 reward);
  event SplitReinvest(address account, uint256 amountReward);
  event SetDexHandler(address dexHandler);
  event SetBonding(address bonding);
  event SetMiningService(address miningService);
  event SetTreasury(address _treasury);

  constructor(
    address _timelock,
    address initialAdmin,
    address _maltToken,
    address _rewardToken,
    address _uniswapV2Factory,
    address _treasury
  ) {
    require(_timelock != address(0), "Reinvestor: Timelock addr(0)");
    require(initialAdmin != address(0), "Reinvestor: Admin addr(0)");
    require(_maltToken != address(0), "Reinvestor: Malt addr(0)");
    require(_rewardToken != address(0), "Reinvestor: RewardToken addr(0)");
    require(_uniswapV2Factory != address(0), "Reinvestor: UniswapFactory addr(0)");
    require(_treasury != address(0), "Reinvestor: Treasury addr(0)");
    _adminSetup(_timelock);
    _setupRole(ADMIN_ROLE, initialAdmin);

    malt = ERC20(_maltToken);
    rewardToken = ERC20(_rewardToken);
    treasury = _treasury;

    stakeToken = ERC20(UniswapV2Library.pairFor(_uniswapV2Factory, _maltToken, _rewardToken));
  }

  function setupContracts(
    address _dexHandler,
    address _bonding,
    address _miningService
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(address(bonding) == address(0), "Reinvestor: Already setup");
    require(_dexHandler != address(0), "Reinvestor: DexHandler addr(0)");
    require(_bonding != address(0), "Reinvestor: Bonding addr(0)");
    require(_miningService != address(0), "Reinvestor: MiningSvc addr(0)");

    dexHandler = IDexHandler(_dexHandler);
    bonding = IBonding(_bonding);
    miningService = IMiningService(_miningService);
  }

  function provideReinvest(uint256 poolId, uint256 rewardLiquidity, uint256 maltLiquidity, uint256 slippageBps)
    external
    nonReentrant
  {
    uint256 rewardBalance = _retrieveReward(rewardLiquidity, poolId);

    // Transfer the remaining Malt required
    malt.safeTransferFrom(msg.sender, address(this), maltLiquidity);

    _bondAccount(msg.sender, poolId, maltLiquidity, rewardBalance, slippageBps);

    emit ProvideReinvest(msg.sender, rewardBalance);
  }

  function splitReinvest(uint256 poolId, uint256 rewardLiquidity, uint256 rewardReserves, uint256 slippageBps)
    external
    nonReentrant
  {
    uint256 rewardBalance = _retrieveReward(rewardLiquidity, poolId);
    uint256 swapAmount = _optimalLiquiditySwap(rewardBalance, rewardReserves);

    rewardToken.safeTransfer(address(dexHandler), swapAmount);
    uint256 amountMalt = dexHandler.buyMalt(swapAmount, slippageBps);

    _bondAccount(msg.sender, poolId, amountMalt, rewardBalance - swapAmount, slippageBps);

    emit SplitReinvest(msg.sender, rewardLiquidity);
  }

  function _retrieveReward(uint256 rewardLiquidity, uint256 poolId) internal returns(uint256) {
    require(rewardLiquidity > 0, "Cannot reinvest 0");

    miningService.withdrawRewardsForAccount(
      msg.sender,
      poolId,
      rewardLiquidity
    );

    return rewardToken.balanceOf(address(this));
  }

  function _bondAccount(
    address account,
    uint256 poolId,
    uint256 amountMalt,
    uint256 amountReward,
    uint256 slippageBps
  ) internal {
    // It is assumed that the calling functions have ensured
    // The token balances are correct
    malt.safeTransfer(address(dexHandler), amountMalt);
    rewardToken.safeTransfer(address(dexHandler), amountReward);

    (,,uint256 liquidityCreated) = dexHandler.addLiquidity(
      amountMalt,
      amountReward,
      slippageBps
    );

    // Ensure starting from 0
    stakeToken.safeApprove(address(bonding), 0);
    stakeToken.safeApprove(address(bonding), liquidityCreated);

    bonding.bondToAccount(account, poolId, liquidityCreated);

    // Reset approval
    stakeToken.safeApprove(address(bonding), 0);

    // If there is any carry / left overs then send to treasury
    uint256 maltBalance = malt.balanceOf(address(this));
    uint256 rewardTokenBalance = rewardToken.balanceOf(address(this));

    if (maltBalance > 0) {
      malt.safeTransfer(treasury, maltBalance);
    }

    if (rewardTokenBalance > 0) {
      rewardToken.safeTransfer(treasury, rewardTokenBalance);
    }
  }

  function _optimalLiquiditySwap(uint256 amountA, uint256 reserveA) internal pure returns (uint256) {
    // assumes 0.3% fee
    return (
      (Babylonian.sqrt(reserveA * ((amountA * 3988000) + (reserveA * 3988009))) - (reserveA * 1997)) / 1994
    );
  }

  function setDexHandler(address _dexHandler)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_dexHandler != address(0), "Not address 0");
    dexHandler = IDexHandler(_dexHandler);
    emit SetDexHandler(_dexHandler);
  }

  function setBonding(address _bonding)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_bonding != address(0), "Not address 0");
    bonding = IBonding(_bonding);
    emit SetBonding(_bonding);
  }

  function setMiningService(address _miningService)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_miningService != address(0), "Not address 0");
    miningService = IMiningService(_miningService);
    emit SetMiningService(_miningService);
  }

  function setTreasury(address _treasury)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_treasury != address(0), "Not address 0");
    treasury = _treasury;
    emit SetTreasury(_treasury);
  }
}
