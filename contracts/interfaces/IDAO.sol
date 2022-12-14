// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;


interface IDAO {
  function epoch() external view returns (uint256);
  function epochLength() external view returns (uint256);
  function genesisTime() external view returns (uint256);
  function getEpochStartTime(uint256 _epoch) external view returns (uint256);
  function getLockedMalt(address account) external view returns (uint256);
  function epochsPerYear() external view returns (uint256);
  function advance() external;
}
