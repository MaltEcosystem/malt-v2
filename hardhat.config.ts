import dotenv from 'dotenv';
import { task, HardhatUserConfig } from "hardhat/config";

import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "hardhat-typechain";
import "solidity-coverage";
import "hardhat-gas-reporter";
import "hardhat-log-remover";
import "hardhat-contract-sizer";
import "@tenderly/hardhat-tenderly";
import { use } from "chai";
import { near, withinPercent } from "./test/assertions";

use(near);
use(withinPercent);

const result = dotenv.config()

if (result.error) {
  throw result.error;
}

if (!process.env.MALT_DEPLOY_KEY) {
  throw new Error("Must define deploy key");
}

// Imported after dotenv incase any of these need env variables
import './tasks/index';

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    version: "0.8.11",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      }
    }
  },
  typechain: {
    outDir: './type',
    target: 'ethers-v5'
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY,
      polygon: process.env.POLYGONSCAN_API_KEY,
      polygonMumbai: process.env.MUMBAI_API_KEY,
    }
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: "http://localhost:8545",
    },
    polygon: {
      url: process.env.POLYGON_RPC_ENDPOINT,
      accounts: [process.env.MALT_DEPLOY_KEY],
    },
    mumbai: {
      url: process.env.MUMBAI_RPC_ENDPOINT,
      accounts: {
        mnemonic: process.env.MALT_TESTNET_DEPLOY_SEED,
      }
    },
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 150,
    enabled: (process.env.REPORT_GAS) ? true : false,
    coinmarketcap: process.env.COINMARKETCAP_KEY,
  },
  tenderly: {
    username: "malt",
    project: "malt-core"
  }
}

export default config;
