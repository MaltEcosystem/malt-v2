import dotenv from 'dotenv';
import { run, ethers, network, artifacts } from "hardhat";
import { Signer, ContractFactory, constants, utils, Contract, BigNumber } from "ethers";
import { Timelock } from "../type/Timelock";
import { ERC20 } from "../type/ERC20";
import { StabilizerNode } from "../type/StabilizerNode";
import { Malt } from "../type/Malt";
import { MaltDAO } from "../type/MaltDAO";
import { Auction } from "../type/Auction";
import { AuctionBurnReserveSkew } from "../type/AuctionBurnReserveSkew";
import { AuctionEscapeHatch } from "../type/AuctionEscapeHatch";
import { AuctionPool } from "../type/AuctionPool";
import { Bonding } from "../type/Bonding";
import { ERC20VestedMine } from "../type/ERC20VestedMine";
import { TestFaucet } from "../type/TestFaucet";
import { ForfeitHandler } from "../type/ForfeitHandler";
import { ImpliedCollateralService } from "../type/ImpliedCollateralService";
import { LiquidityExtension } from "../type/LiquidityExtension";
import { MaltDataLab } from "../type/MaltDataLab";
import { MiningService } from "../type/MiningService";
import { DualMovingAverage } from "../type/DualMovingAverage";
import { PoolTransferVerification } from "../type/PoolTransferVerification";
import { RewardReinvestor } from "../type/RewardReinvestor";
import { SwingTrader } from "../type/SwingTrader";
import { TransferService } from "../type/TransferService";
import { UniswapHandler } from "../type/UniswapHandler";
import { RewardDistributor } from "../type/RewardDistributor";
import { RewardOverflowPool } from "../type/RewardOverflowPool";
import { RewardThrottle } from "../type/RewardThrottle";
import { deterministicDeploy } from './helpers/utils';

import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";

import UniswapV2FactoryBuild from "@uniswap/v2-core/build/UniswapV2Factory.json";
const UniswapV2FactoryAbi = UniswapV2FactoryBuild.abi;

import { promises, existsSync } from 'fs'

const result = dotenv.config()

if (result.error) {
  throw result.error;
}

let deployers: { [key: string]: string } = {
  polygon: "0x54F5A04417E29FF5D7141a6d33cb286F50d5d50e",
  mumbai: "0xf58fbEC439918Bd9e636AC1363e4FF2C0DD8b648",
  localhost: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
}

let rewardTokens: { [key: string]: string } = {
  polygon: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
  mumbai: "0xaFf77C74E2a3861225173C2325314842338b73e6",
  localhost: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
}

let dexAddresses: { [key: string]: { [key: string]: string }} = {
  polygon: {
    factory: "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32",
    router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
  },
  mumbai: {
    factory: "0xf019B26D2DDB6E25E2a8CCbE5235eEB0eF354B4c",
    router: "0x2aae055f88e26051989b377c2A269Af545648B85",
  },
  localhost: {
    router: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    factory: "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  }
}

let whitelistContracts: { [key: string]: string } = {
  polygon: "0x880a0cE7D1eD1BC3062e4A95DC57127e6f2d55A0",
  mumbai: "0x880a0cE7D1eD1BC3062e4A95DC57127e6f2d55A0",
  localhost: "",
}

const GAS_COST_GWEI = 100;

async function deploy() {
  await run("typechain");

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log(signerAddress);

  if (!process.env.MALT_TREASURY_ADDRESS) {
    throw new Error("No treasury address given");
  }
  const treasuryAddress = process.env.MALT_TREASURY_ADDRESS;

  // Initial variables
  const epochLength = 60 * 30; // 30 minutes
  const genesisTime = 1651946400;
  const priceTarget = utils.parseEther('1');

  // Fetch contract factories
  const AuctionFactory = await ethers.getContractFactory("Auction");
  const BurnReserveSkewFactory = await ethers.getContractFactory("AuctionBurnReserveSkew");
  const AuctionEscapeHatchFactory = await ethers.getContractFactory("AuctionEscapeHatch");
  const AuctionPoolFactory = await ethers.getContractFactory("AuctionPool");
  const BondingFactory = await ethers.getContractFactory("Bonding");
  const DAOFactory = await ethers.getContractFactory("MaltDAO");
  const ERC20VestedMineFactory = await ethers.getContractFactory("ERC20VestedMine");
  const ForfeitHandlerFactory = await ethers.getContractFactory("ForfeitHandler");
  const ImpliedCollateralServiceFactory = await ethers.getContractFactory("ImpliedCollateralService");
  const LiquidityExtensionFactory = await ethers.getContractFactory("LiquidityExtension");
  const MaltFactory = await ethers.getContractFactory("Malt");
  const MaltDataLabFactory = await ethers.getContractFactory("MaltDataLab");
  const MiningServiceFactory = await ethers.getContractFactory("MiningService");
  const DualMovingAverageFactory = await ethers.getContractFactory("DualMovingAverage");
  const PoolTransferVerificationFactory = await ethers.getContractFactory("PoolTransferVerification");
  const RewardReinvestorFactory = await ethers.getContractFactory("RewardReinvestor");
  const StabilizerNodeFactory = await ethers.getContractFactory("StabilizerNode");
  const SwingTraderFactory = await ethers.getContractFactory("SwingTrader");
  const TimelockFactory = await ethers.getContractFactory("Timelock");
  const TransferServiceFactory = await ethers.getContractFactory("TransferService");
  const UniswapHandlerFactory = await ethers.getContractFactory("UniswapHandler");
  const RewardDistributorFactory = await ethers.getContractFactory("RewardDistributor");
  const RewardOverflowPoolFactory = await ethers.getContractFactory("RewardOverflowPool");
  const RewardThrottleFactory = await ethers.getContractFactory("RewardThrottle");

  const dai = new Contract(rewardTokens[network.name], IERC20.abi, signer);
  const factory = new Contract(dexAddresses[network.name].factory, UniswapV2FactoryAbi, signer);

  const txConfig = {
    gasPrice: utils.parseUnits('50', 'gwei'),
    gasLimit: 10000000
  }

  try {
    console.log('timelock');
    const timelockDeployment = await deterministicDeploy(
      TimelockFactory,
      ["address"], // constructor types
      [signerAddress], // constructor args
      deployers[network.name],
    );
    const timelock = timelockDeployment.contract;
    console.log(timelock.address);

    console.log('transfer service');
    const transferServiceDeployment = await deterministicDeploy(
      TransferServiceFactory,
      ["address", "address"], // constructor types
      [timelock.address, signerAddress], // constructor args
      deployers[network.name],
    );
    const transferService = transferServiceDeployment.contract;
    console.log(transferService.address);

    console.log('malt');
    const maltDeployment = await deterministicDeploy(
      MaltFactory,
      ["string", "string", "address", "address", "address"], // constructor types
      ["Malt Stablecoin (V2)", "MALT", timelock.address, signerAddress, transferService.address], // constructor args
      deployers[network.name],
    );
    const malt = maltDeployment.contract;
    console.log(malt.address);

    console.log('dao');
    const daoDeployment = await deterministicDeploy(
      DAOFactory,
      ["address", "address", "uint256", "uint256"], // constructor types
      [timelock.address, signerAddress, epochLength, genesisTime], // constructor args
      deployers[network.name],
    );
    const dao = daoDeployment.contract;
    console.log(dao.address);

    /*
     * DEPLOY POOL CONTRACTS
     */
    const createPair = await factory.createPair(malt.address, dai.address, txConfig);
    await createPair.wait();

    const lpTokenAddress = await factory.getPair(malt.address, dai.address);
    console.log(lpTokenAddress);

    console.log('maltPoolMA');
    const maltPoolMaDeployment = await deterministicDeploy(
      DualMovingAverageFactory,
      ["address", "address", "uint256", "uint256", "uint256", "uint256"], // constructor types
      [timelock.address, signerAddress, 30, 60, utils.parseEther('2'), utils.parseEther('0')], // constructor args
      deployers[network.name],
    );
    const maltPoolMA = maltPoolMaDeployment.contract;
    console.log(maltPoolMA.address);

    console.log('Malt Data Lab');
    const maltDataLabDeployment = await deterministicDeploy(
      MaltDataLabFactory,
      ["address", "address", "address", "address", "address", "uint256", "address"], // constructor types
      [timelock.address, signerAddress, malt.address, dai.address, lpTokenAddress, priceTarget, maltPoolMA.address], // constructor args
      deployers[network.name],
    );
    const maltDataLab = maltDataLabDeployment.contract;
    console.log(maltDataLab.address);

    console.log('Uniswap Handler');
    const routerAddress = dexAddresses[network.name].router;
    const uniswapHandlerDeployment = await deterministicDeploy(
      UniswapHandlerFactory,
      ["address", "address", "address", "address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, malt.address, dai.address, lpTokenAddress, routerAddress, maltDataLab.address], // constructor args
      deployers[network.name],
    );
    const uniswapHandler = uniswapHandlerDeployment.contract;
    console.log(uniswapHandler.address);

    console.log('stabilizer node');
    const stabilizerNodeDeployment = await deterministicDeploy(
      StabilizerNodeFactory,
      ["address", "address", "address", "address", "address", "uint256"], // constructor types
      [timelock.address, signerAddress, malt.address, dai.address, treasuryAddress, utils.parseEther("100")], // constructor args
      deployers[network.name],
    );
    const stabilizerNode = stabilizerNodeDeployment.contract;
    console.log(stabilizerNode.address);

    console.log('auction pool');
    const auctionPoolDeployment = await deterministicDeploy(
      AuctionPoolFactory,
      ["address", "address", "uint256"], // constructor types
      [timelock.address, signerAddress, 0], // constructor args
      deployers[network.name],
    );
    const auctionPool = auctionPoolDeployment.contract;
    console.log(auctionPool.address);

    console.log('auction');
    const auctionDeployment = await deterministicDeploy(
      AuctionFactory,
      ["address", "address", "address", "address", "uint256", "address", "address", "address", "uint256"], // constructor types
      [timelock.address, signerAddress, dai.address, malt.address, 60*10, stabilizerNode.address, maltDataLab.address, uniswapHandler.address, utils.parseEther('10')], // constructor args
      deployers[network.name],
    );
    const auction = auctionDeployment.contract;
    console.log(auction.address);

    console.log('escape hatch');
    const escapeHatchDeployment = await deterministicDeploy(
      AuctionEscapeHatchFactory,
      ["address", "address", "address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, auction.address, uniswapHandler.address, dai.address, malt.address], // constructor args
      deployers[network.name],
    );
    const escapeHatch = escapeHatchDeployment.contract;
    console.log(escapeHatch.address);

    console.log('liquidity extension');
    const liquidityExtensionDeployment = await deterministicDeploy(
      LiquidityExtensionFactory,
      ["address", "address", "address", "address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, auction.address, dai.address, malt.address, uniswapHandler.address, maltDataLab.address], // constructor args
      deployers[network.name],
    );
    const liquidityExtension = liquidityExtensionDeployment.contract;
    console.log(liquidityExtension.address);

    console.log('burn reserve skew');
    const burnReserveSkewDeployment = await deterministicDeploy(
      BurnReserveSkewFactory,
      ["address", "address", "address", "address", "uint256"], // constructor types
      [timelock.address, signerAddress, stabilizerNode.address, auction.address, 10], // constructor args
      deployers[network.name],
    );
    const burnReserveSkew = burnReserveSkewDeployment.contract;
    console.log(burnReserveSkew.address);

    console.log('implied collateral');
    const impliedCollateralServiceDeployment = await deterministicDeploy(
      ImpliedCollateralServiceFactory,
      ["address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, dai.address, malt.address], // constructor args
      deployers[network.name],
    );
    const impliedCollateralService = impliedCollateralServiceDeployment.contract;
    console.log(impliedCollateralService.address);

    console.log('reward reinvestor');
    const rewardReinvestorDeployment = await deterministicDeploy(
      RewardReinvestorFactory,
      ["address", "address", "address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, malt.address, dai.address, factory.address, treasuryAddress], // constructor args
      deployers[network.name],
    );
    const rewardReinvestor = rewardReinvestorDeployment.contract;
    console.log(rewardReinvestor.address);

    console.log('mining service');
    const miningServiceDeployment = await deterministicDeploy(
      MiningServiceFactory,
      ["address", "address"], // constructor types
      [timelock.address, signerAddress], // constructor args
      deployers[network.name],
    );
    const miningService = miningServiceDeployment.contract;
    console.log(miningService.address);

    console.log('reward distirbutor');
    const rewardDistributorDeployment = await deterministicDeploy(
      RewardDistributorFactory,
      ["address", "address", "address"], // constructor types
      [timelock.address, signerAddress, dai.address], // constructor args
      deployers[network.name],
    );
    const rewardDistributor = rewardDistributorDeployment.contract;
    console.log(rewardDistributor.address);

    console.log('bonding');
    const bondingDeployment = await deterministicDeploy(
      BondingFactory,
      ["address", "address", "address", "address", "address", "address", "address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, malt.address, dai.address, lpTokenAddress, dao.address, miningService.address, uniswapHandler.address, maltDataLab.address, rewardDistributor.address], // constructor args
      deployers[network.name],
    );
    const bonding = bondingDeployment.contract;
    console.log(bonding.address);

    console.log('forfeit handler');
    const forfeitHandlerDeployment = await deterministicDeploy(
      ForfeitHandlerFactory,
      ["address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, dai.address, treasuryAddress], // constructor args
      deployers[network.name],
    );
    const forfeitHandler = forfeitHandlerDeployment.contract;
    console.log(forfeitHandler.address);

    console.log('reward overflow');
    const rewardOverflowDeployment = await deterministicDeploy(
      RewardOverflowPoolFactory,
      ["address", "address"], // constructor types
      [timelock.address, signerAddress], // constructor args
      deployers[network.name],
    );
    const rewardOverflow = rewardOverflowDeployment.contract;
    console.log(rewardOverflow.address);

    console.log('reward throttle');
    const rewardThrottleDeployment = await deterministicDeploy(
      RewardThrottleFactory,
      ["address", "address", "address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, dao.address, rewardOverflow.address, bonding.address, dai.address], // constructor args
      deployers[network.name],
    );
    const rewardThrottle = rewardThrottleDeployment.contract;
    console.log(rewardThrottle.address);

    console.log('transfer verification');
    const transferVerificationDeployment = await deterministicDeploy(
      PoolTransferVerificationFactory,
      ["address", "address", "uint256", "uint256", "address", "uint256", "uint256", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, 200, 200, maltDataLab.address, 30, 60 * 5, lpTokenAddress, stabilizerNode.address, auction.address], // constructor args
      deployers[network.name],
    );
    const transferVerification = transferVerificationDeployment.contract;
    console.log(transferVerification.address);

    console.log('swing trader');
    const swingTraderDeployment = await deterministicDeploy(
      SwingTraderFactory,
      ["address", "address", "address", "address", "address", "address", "address"], // constructor types
      [timelock.address, signerAddress, dai.address, malt.address, uniswapHandler.address, stabilizerNode.address, rewardThrottle.address], // constructor args
      deployers[network.name],
    );
    const swingTrader = swingTraderDeployment.contract;
    console.log(swingTrader.address);

    console.log('erc20 mine');
    const erc20MineDeployment = await deterministicDeploy(
      ERC20VestedMineFactory,
      ["address", "address", "address", "address", "address", "address", "uint256"], // constructor types
      [timelock.address, signerAddress, miningService.address, rewardDistributor.address, bonding.address, dai.address, 0], // constructor args
      deployers[network.name],
    );
    const erc20Mine = erc20MineDeployment.contract;
    console.log(erc20Mine.address);




    // Deploy the contracts
    // const timelock = (await TimelockFactory.deploy(signerAddress, txConfig)) as Timelock;
    // const transferService = (await TransferServiceFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   txConfig
    // )) as TransferService;

    // await timelock.deployTransaction.wait();
    // await transferService.deployTransaction.wait();

    // const malt = (await MaltFactory.deploy(
    //   "Malt Stablecoin",
    //   "MALT",
    //   signerAddress,
    //   signerAddress,
    //   transferService.address,
    //   txConfig
    // )) as Malt;
    // await malt.deployTransaction.wait();

    // const dao = (await DAOFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   epochLength,
    //   genesisTime,
    //   txConfig
    // )) as MaltDAO;

    // const maltPoolMA = (await DualMovingAverageFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   30, // 30 secs
    //   60, // 30 mins worth
    //   utils.parseEther('2'),
    //   utils.parseEther('0'),
    //   txConfig
    // )) as DualMovingAverage;
    // const maltDataLab = (await MaltDataLabFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   malt.address,
    //   dai.address,
    //   lpTokenAddress,
    //   priceTarget,
    //   maltPoolMA.address,
    //   txConfig
    // )) as MaltDataLab;
    // const uniswapHandler = (await UniswapHandlerFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   malt.address,
    //   dai.address,
    //   lpTokenAddress,
    //   router.address,
    //   maltDataLab.address,
    //   txConfig
    // )) as UniswapHandler;

    // const stabilizerNode = (await StabilizerNodeFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   malt.address,
    //   dai.address,
    //   treasuryAddress,
    //   utils.parseEther('100'), // 100 DAI skipAuctionThreshold
    //   txConfig
    // )) as StabilizerNode;

    // const auctionPool = (await AuctionPoolFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   0,
    //   txConfig
    // )) as AuctionPool;
    // const auction = (await AuctionFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   dai.address,
    //   malt.address,
    //   60 * 10, // 10 mins auction length
    //   stabilizerNode.address,
    //   maltDataLab.address,
    //   uniswapHandler.address,
    //   utils.parseEther('10'), // 10 DAI early exit threshold
    //   txConfig
    // )) as Auction;
    // const escapeHatch = (await AuctionEscapeHatchFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   auction.address,
    //   uniswapHandler.address,
    //   dai.address,
    //   malt.address,
    //   txConfig
    // )) as AuctionEscapeHatch;
    // const liquidityExtension = (await LiquidityExtensionFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   auction.address,
    //   dai.address,
    //   malt.address,
    //   uniswapHandler.address,
    //   maltDataLab.address,
    //   txConfig
    // )) as LiquidityExtension;
    // const burnReserveSkew = (await BurnReserveSkewFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   stabilizerNode.address,
    //   auction.address,
    //   10,
    //   txConfig
    // )) as AuctionBurnReserveSkew;
    // const impliedCollateralService = (await ImpliedCollateralServiceFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   dai.address,
    //   malt.address,
    //   txConfig
    // )) as ImpliedCollateralService;
    // const rewardReinvestor = (await RewardReinvestorFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   malt.address,
    //   dai.address,
    //   factory.address,
    //   treasuryAddress,
    //   txConfig
    // )) as RewardReinvestor;
    // const miningService = (await MiningServiceFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   txConfig
    // )) as MiningService;
    // const rewardDistributor = (await RewardDistributorFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   dai.address,
    //   txConfig
    // )) as RewardDistributor;
    // const bonding = (await BondingFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   malt.address,
    //   dai.address,
    //   lpTokenAddress,
    //   dao.address,
    //   miningService.address,
    //   uniswapHandler.address,
    //   maltDataLab.address,
    //   rewardDistributor.address,
    //   txConfig
    // )) as Bonding;

    // const forfeitHandler = (await ForfeitHandlerFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   dai.address,
    //   treasuryAddress,
    //   txConfig
    // )) as ForfeitHandler;
    // const rewardOverflow = (await RewardOverflowPoolFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   txConfig
    // )) as RewardOverflowPool;
    // const rewardThrottle = (await RewardThrottleFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   dao.address,
    //   rewardOverflow.address,
    //   bonding.address,
    //   dai.address,
    //   txConfig
    // )) as RewardThrottle;

    // const transferVerification = (await PoolTransferVerificationFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   200, // 2% lower threshold
    //   200, // 2% upper threshold
    //   maltDataLab.address,
    //   30, // 30 seconds
    //   60 * 5, // 5 minutes
    //   lpTokenAddress,
    //   stabilizerNode.address,
    //   auction.address,
    //   txConfig
    // )) as PoolTransferVerification;

    // const swingTrader = (await SwingTraderFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   dai.address,
    //   malt.address,
    //   uniswapHandler.address,
    //   stabilizerNode.address,
    //   rewardThrottle.address,
    //   txConfig
    // )) as SwingTrader;

    // const erc20Mine = (await ERC20VestedMineFactory.deploy(
    //   timelock.address,
    //   signerAddress,
    //   miningService.address,
    //   rewardDistributor.address,
    //   bonding.address,
    //   dai.address,
    //   0,
    //   txConfig
    // )) as ERC20VestedMine;

    let gasUsed = auctionDeployment.deployment.gasLimit;
    gasUsed = gasUsed.add(burnReserveSkewDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(escapeHatchDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(auctionPoolDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(bondingDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(daoDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(erc20MineDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(forfeitHandlerDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(impliedCollateralServiceDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(liquidityExtensionDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(maltDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(maltDataLabDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(miningServiceDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(maltPoolMaDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(transferVerificationDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(rewardReinvestorDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(stabilizerNodeDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(swingTraderDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(timelockDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(transferServiceDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(uniswapHandlerDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(rewardDistributorDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(rewardOverflowDeployment.deployment.gasLimit)
    gasUsed = gasUsed.add(rewardThrottleDeployment.deployment.gasLimit)

    console.log(`Total gas usage for deploy: ${gasUsed}`);

    // Use GAS_COST_GWEI as a benchmark
    const deployGasCost = gasUsed.mul(utils.parseUnits(GAS_COST_GWEI.toString(), 'gwei'));
    console.log(`Gas cost @ ${GAS_COST_GWEI}Gwei: ${utils.formatEther(deployGasCost)}`);

    const forfeitSwingTx = await forfeitHandler.setSwingTrader(swingTrader.address, txConfig);

    const auctionPoolSetup = await auctionPool.setupContracts(
      auction.address,
      impliedCollateralService.address,
      bonding.address,
      miningService.address,
      swingTrader.address,
      dai.address,
      txConfig
    );
    const auctionSetup = await auction.setupContracts(
      liquidityExtension.address,
      impliedCollateralService.address,
      burnReserveSkew.address,
      escapeHatch.address,
      auctionPool.address,
      txConfig
    );
    const impliedCollateralSetup = await impliedCollateralService.setupContracts(
      auction.address,
      auctionPool.address,
      rewardOverflow.address,
      swingTrader.address,
      liquidityExtension.address,
      maltDataLab.address,
      txConfig
    );
    const reinvestorSetup = await rewardReinvestor.setupContracts(
      uniswapHandler.address,
      bonding.address,
      miningService.address,
      txConfig
    );
    const miningServiceSetup = await miningService.setupContracts(
      rewardReinvestor.address,
      bonding.address,
      txConfig
    );
    const overflowSetup = await rewardOverflow.setupContracts(
      rewardThrottle.address,
      auction.address,
      impliedCollateralService.address,
      dai.address,
      txConfig
    );
    const distributorSetup = await rewardDistributor.setupContracts(
      erc20Mine.address,
      bonding.address,
      rewardThrottle.address,
      forfeitHandler.address,
      txConfig
    );
    let stabilizerNodeContractSetup = await stabilizerNode.setupContracts(
      uniswapHandler.address,
      maltDataLab.address,
      burnReserveSkew.address,
      rewardThrottle.address,
      dao.address,
      swingTrader.address,
      liquidityExtension.address,
      impliedCollateralService.address,
      auction.address,
      auctionPool.address,
      txConfig
    );

    const maltSetup = await malt.initialSupplyControlSetup(
      [dao.address, escapeHatch.address, stabilizerNode.address],
      [liquidityExtension.address],
      txConfig
    );

    const addVerifierTx = await transferService.addVerifier(lpTokenAddress, transferVerification.address, txConfig);

    await forfeitSwingTx.wait();
    await auctionPoolSetup.wait();
    await auctionSetup.wait();
    await impliedCollateralSetup.wait();
    await reinvestorSetup.wait();
    await miningServiceSetup.wait();
    await overflowSetup.wait();
    await distributorSetup.wait();
    await stabilizerNodeContractSetup.wait();
    await maltSetup.wait();
    await addVerifierTx.wait();

    const daoMaltTokenTx = await dao.setMaltToken(
      malt.address,
      utils.parseEther('718263.310278568246028629'),
      whitelistContracts[network.name],
      txConfig
    );

    const UPDATER_ROLE = utils.id("UPDATER_ROLE");
    const grantUpdaterTx = await maltPoolMA.grantRoleMultiple(
      UPDATER_ROLE,
      [maltDataLab.address],
      txConfig
    );
    const BUYER_ROLE = utils.id("BUYER_ROLE");
    const grantBuyerTx = await uniswapHandler.grantRoleMultiple(
      BUYER_ROLE,
      [
        rewardReinvestor.address,
        liquidityExtension.address,
        swingTrader.address
      ],
      txConfig
    );
    const SELLER_ROLE = utils.id("SELLER_ROLE");
    const grantSellerTx = await uniswapHandler.grantRoleMultiple(
      SELLER_ROLE,
      [
        escapeHatch.address,
        swingTrader.address,
        stabilizerNode.address,
      ],
      txConfig
    );
    const LIQUIDITY_ADDER_ROLE = utils.id("LIQUIDITY_ADDER_ROLE");
    const grantLiqAdderTx = await uniswapHandler.grantRole(
      LIQUIDITY_ADDER_ROLE,
      rewardReinvestor.address,
      txConfig
    );
    const LIQUIDITY_REMOVER_ROLE = utils.id("LIQUIDITY_REMOVER_ROLE");
    const grantLiqRemoverTx = await uniswapHandler.grantRole(
      LIQUIDITY_REMOVER_ROLE,
      bonding.address,
      txConfig
    );

    const dexTransferWhitelistTx = await transferVerification.addToWhitelist(uniswapHandler.address, txConfig);
    const vestedMineAddTx = await miningService.addRewardMine(erc20Mine.address, 0, txConfig);
    const auctionPoolAddTx = await miningService.addRewardMine(auctionPool.address, 0, txConfig);

    await daoMaltTokenTx.wait();
    await dexTransferWhitelistTx.wait();
    await vestedMineAddTx.wait();
    await auctionPoolAddTx.wait();
    await grantBuyerTx.wait();
    await grantSellerTx.wait();
    await grantLiqAdderTx.wait();
    await grantLiqRemoverTx.wait();

    gasUsed = gasUsed.add(addVerifierTx.gasLimit)
    gasUsed = gasUsed.add(grantBuyerTx.gasLimit)
    gasUsed = gasUsed.add(grantSellerTx.gasLimit)
    gasUsed = gasUsed.add(grantLiqAdderTx.gasLimit)
    gasUsed = gasUsed.add(grantLiqRemoverTx.gasLimit)
    gasUsed = gasUsed.add(dexTransferWhitelistTx.gasLimit)
    gasUsed = gasUsed.add(vestedMineAddTx.gasLimit)
    gasUsed = gasUsed.add(auctionPoolAddTx.gasLimit)
    gasUsed = gasUsed.add(daoMaltTokenTx.gasLimit)
    gasUsed = gasUsed.add(forfeitSwingTx.gasLimit)
    gasUsed = gasUsed.add(auctionPoolSetup.gasLimit)
    gasUsed = gasUsed.add(auctionSetup.gasLimit)
    gasUsed = gasUsed.add(impliedCollateralSetup.gasLimit)
    gasUsed = gasUsed.add(reinvestorSetup.gasLimit)
    gasUsed = gasUsed.add(miningServiceSetup.gasLimit)
    gasUsed = gasUsed.add(overflowSetup.gasLimit)
    gasUsed = gasUsed.add(distributorSetup.gasLimit)
    gasUsed = gasUsed.add(stabilizerNodeContractSetup.gasLimit)
    gasUsed = gasUsed.add(maltSetup.gasLimit)

    console.log(`Total gas usage: ${gasUsed}`);

    // Use GAS_COST_GWEI as a benchmark
    const gasCost = gasUsed.mul(utils.parseUnits(GAS_COST_GWEI.toString(), 'gwei'));
    console.log(`Gas cost @ ${GAS_COST_GWEI}Gwei: ${utils.formatEther(gasCost)}`);

    const contractAddresses = {
      /* CORE GLOBAL CONTRACTS */
      dao: {
        address: dao.address,
        artifacts: artifacts.readArtifactSync("MaltDAO"),
      },
      malt: {
        address: malt.address,
        artifacts: artifacts.readArtifactSync("Malt"),
      },
      transferService: {
        address: transferService.address,
        artifacts: artifacts.readArtifactSync("TransferService"),
      },
      timelock: {
        address: timelock.address,
        artifacts: artifacts.readArtifactSync("Timelock"),
      },

      /* UNISWAP AMM CONTRACTS */
      router: {
        address: routerAddress,
        artifacts: artifacts.readArtifactSync("@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol:IUniswapV2Router02"),
      },
      factory: {
        address: factory.address,
        artifacts: artifacts.readArtifactSync("@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol:IUniswapV2Factory"),
      },

      /* LP POOL SPECIFIC */
      rewardToken: {
        address: dai.address,
        artifacts: artifacts.readArtifactSync("Malt"),
      },
      transferVerification: {
        address: transferVerification.address,
        artifacts: artifacts.readArtifactSync("PoolTransferVerification"),
      },
      uniswapHandler: {
        address: uniswapHandler.address,
        artifacts: artifacts.readArtifactSync("UniswapHandler"),
      },
      maltPair: {
        address: lpTokenAddress,
        artifacts: artifacts.readArtifactSync("@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol:IUniswapV2Pair"),
      },

      /* POOL DATA CONTRACTS */
      maltDataLab: {
        address: maltDataLab.address,
        artifacts: artifacts.readArtifactSync("MaltDataLab"),
      },
      maltPoolMA: {
        address: maltPoolMA.address,
        artifacts: artifacts.readArtifactSync("DualMovingAverage"),
      },

      /* STABILITY CONTRACTS */
      stabilizerNode: {
        address: stabilizerNode.address,
        artifacts: artifacts.readArtifactSync("StabilizerNode"),
      },
      impliedCollateralService: {
        address: impliedCollateralService.address,
        artifacts: artifacts.readArtifactSync("ImpliedCollateralService"),
      },
      swingTrader: {
        address: swingTrader.address,
        artifacts: artifacts.readArtifactSync("SwingTrader"),
      },

      /* REWARD SYSTEM */
      rewardDistributor: {
        address: rewardDistributor.address,
        artifacts: artifacts.readArtifactSync("RewardDistributor"),
      },
      rewardOverflow: {
        address: rewardOverflow.address,
        artifacts: artifacts.readArtifactSync("RewardOverflowPool"),
      },
      rewardThrottle: {
        address: rewardThrottle.address,
        artifacts: artifacts.readArtifactSync("RewardThrottle"),
      },

      /* AUCTION CONTRACTS */
      auction: {
        address: auction.address,
        artifacts: artifacts.readArtifactSync("Auction"),
      },
      burnReserveSkew: {
        address: burnReserveSkew.address,
        artifacts: artifacts.readArtifactSync("AuctionBurnReserveSkew"),
      },
      escapeHatch: {
        address: escapeHatch.address,
        artifacts: artifacts.readArtifactSync("AuctionEscapeHatch"),
      },
      auctionPool: {
        address: auctionPool.address,
        artifacts: artifacts.readArtifactSync("AuctionPool"),
      },
      liquidityExtension: {
        address: liquidityExtension.address,
        artifacts: artifacts.readArtifactSync("LiquidityExtension"),
      },

      /* USER REWARD SYSTEM CONTRACTS */
      bonding: {
        address: bonding.address,
        artifacts: artifacts.readArtifactSync("Bonding"),
      },
      daiVestedMine: {
        address: erc20Mine.address,
        artifacts: artifacts.readArtifactSync("ERC20VestedMine"),
      },
      miningService: {
        address: miningService.address,
        artifacts: artifacts.readArtifactSync("MiningService"),
      },
      rewardReinvestor: {
        address: rewardReinvestor.address,
        artifacts: artifacts.readArtifactSync("RewardReinvestor"),
      },
      forfeitHandler: {
        address: forfeitHandler.address,
        artifacts: artifacts.readArtifactSync("ForfeitHandler"),
      },
    }

    if (existsSync('./deployments')) {
      await promises.writeFile(
        `./deployments/contracts.${network.name}.json`,
        JSON.stringify(contractAddresses, undefined, 2)
      );
    }
    if (existsSync('../ui')) {
      await promises.writeFile(
        `../ui/contracts/contracts.${network.name}.json`,
        JSON.stringify(contractAddresses, undefined, 2)
      );
    }
  } catch (error) {
    console.error(error);
  }
}


deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

