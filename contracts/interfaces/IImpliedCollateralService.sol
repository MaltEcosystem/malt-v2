// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;


interface IImpliedCollateralService {
  function handleDeficit(uint256 maxAmount) external;
  function claim() external;
  function getCollateralValueInMalt() external view returns(uint256);
}
