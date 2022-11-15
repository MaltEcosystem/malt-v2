// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;


import "./IAuction.sol";

interface IStabilizerNode {
  function stabilize() external;
  function auction() external view returns (IAuction);
}
