// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.8.11;

interface IUniswapV2Migrator {
    function migrate(address token, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external;
}
