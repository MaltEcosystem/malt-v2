// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;


interface IMaltDataLab {
  function priceTarget() external view returns (uint256);
  function smoothedMaltPrice() external view returns (uint256);
  function smoothedK() external view returns (uint256);
  function smoothedReserves() external view returns (uint256);
  function maltPriceAverage(uint256 _lookback) external view returns (uint256);
  function kAverage(uint256 _lookback) external view returns (uint256);
  function poolReservesAverage(uint256 _lookback) external view returns (uint256, uint256);
  function lastMaltPrice() external view returns (uint256, uint64);
  function lastPoolReserves() external view returns (uint256, uint256, uint64);
  function lastK() external view returns (uint256, uint64);
  function realValueOfLPToken(uint256 amount) external view returns (uint256);
  function trackPool() external;
  function trustedTrackPool(uint256, uint256, uint256) external;
  function rewardToken() external view returns(address);
  function malt() external view returns(address);
  function stakeToken() external view returns(address);
}
