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
import { TestFaucetTwo } from "../type/TestFaucetTwo";
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

import UniswapV2RouterBuild from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import UniswapV2FactoryBuild from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETHBuild from "@uniswap/v2-periphery/build/WETH9.json";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";

import { promises, existsSync } from 'fs'

const result = dotenv.config()

if (result.error) {
  throw result.error;
}

const UniswapV2FactoryBytecode = UniswapV2FactoryBuild.bytecode;
const UniswapV2FactoryAbi = UniswapV2FactoryBuild.abi;

const UniswapV2RouterBytecode = UniswapV2RouterBuild.bytecode;
const UniswapV2RouterAbi = UniswapV2RouterBuild.abi;
const WETHBytecode = WETHBuild.bytecode;
const WETHAbi = WETHBuild.abi;

const GAS_COST_GWEI = 50;

async function deploy() {
  await run("typechain");

  const [signer, treasury] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log(signerAddress);

  let treasuryAddress;

  if (process.env.MALT_TREASURY_ADDRESS) {
    treasuryAddress = process.env.MALT_TREASURY_ADDRESS;
  } else if (treasury) {
    treasuryAddress = await treasury.getAddress();
  } else {
    throw new Error("No treasury address given");
  }

  const now = Math.floor(new Date().getTime() / 1000);

  // Initial variables
  const epochLength = 60 * 30; // 30 minutes
  // const genesisTime = now - (now % epochLength);
  const genesisTime = now;
  const priceTarget = utils.parseEther('1');

  // Fetch contract factories
  const AuctionFactory = await ethers.getContractFactory("Auction");
  const BurnReserveSkewFactory = await ethers.getContractFactory("AuctionBurnReserveSkew");
  const AuctionEscapeHatchFactory = await ethers.getContractFactory("AuctionEscapeHatch");
  const AuctionPoolFactory = await ethers.getContractFactory("AuctionPool");
  const BondingFactory = await ethers.getContractFactory("Bonding");
  const DAOFactory = await ethers.getContractFactory("MaltDAO");
  const ERC20VestedMineFactory = await ethers.getContractFactory("ERC20VestedMine");
  const FaucetFactory = await ethers.getContractFactory("TestFaucet");
  const FaucetTwoFactory = await ethers.getContractFactory("TestFaucetTwo");
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

  const routerContract = new ContractFactory(UniswapV2RouterAbi, UniswapV2RouterBytecode, signer);
  const wethContract = new ContractFactory(WETHAbi, WETHBytecode, signer);
  const factoryContract = new ContractFactory(UniswapV2FactoryAbi, UniswapV2FactoryBytecode, signer);

  try {
    // Local Uniswap deploy
    const factory = await factoryContract.deploy(constants.AddressZero);
    const weth = await wethContract.deploy();
    const router = await routerContract.deploy(factory.address, weth.address);

    // Deploy the contracts
    const timelock = (await TimelockFactory.deploy(signerAddress)) as Timelock;
    const transferService = (await TransferServiceFactory.deploy(
      timelock.address,
      signerAddress,
    )) as TransferService;

    await timelock.deployTransaction.wait();
    await transferService.deployTransaction.wait();

    const malt = (await MaltFactory.deploy(
      "Malt Stablecoin",
      "MALT",
      timelock.address,
      signerAddress,
      transferService.address
    )) as Malt;

    const daiTransferService = (await TransferServiceFactory.deploy(
      timelock.address,
      signerAddress,
    )) as TransferService;
    await daiTransferService.deployTransaction.wait();

    const dai = (await MaltFactory.deploy(
      "Dai Stablecoin",
      "DAI",
      timelock.address,
      signerAddress,
      daiTransferService.address
    )) as Malt;

    await malt.deployTransaction.wait();
    await dai.deployTransaction.wait();

    const dao = (await DAOFactory.deploy(
      timelock.address,
      signerAddress,
      epochLength,
      genesisTime
    )) as MaltDAO;

    const faucet = (await FaucetFactory.deploy(dai.address)) as TestFaucet;
    const faucetTwo = (await FaucetTwoFactory.deploy(faucet.address, dai.address)) as TestFaucetTwo;

    /*
     * DEPLOY POOL CONTRACTS
     */
    const createPair = await factory.createPair(malt.address, dai.address);
    await createPair.wait();

    const lpTokenAddress = await factory.getPair(malt.address, dai.address);

    const maltPoolMA = (await DualMovingAverageFactory.deploy(
      timelock.address,
      signerAddress,
      30, // 30 secs
      60, // 30 mins worth
      utils.parseEther('2'),
      utils.parseEther('0')
    )) as DualMovingAverage;
    const maltDataLab = (await MaltDataLabFactory.deploy(
      timelock.address,
      signerAddress,
      malt.address,
      dai.address,
      lpTokenAddress,
      priceTarget,
      maltPoolMA.address
    )) as MaltDataLab;
    const uniswapHandler = (await UniswapHandlerFactory.deploy(
      timelock.address,
      signerAddress,
      malt.address,
      dai.address,
      lpTokenAddress,
      router.address,
      maltDataLab.address
    )) as UniswapHandler;

    const stabilizerNode = (await StabilizerNodeFactory.deploy(
      timelock.address,
      signerAddress,
      malt.address,
      dai.address,
      treasuryAddress,
      utils.parseEther('100'), // 100 DAI skipAuctionThreshold
    )) as StabilizerNode;

    const auctionPool = (await AuctionPoolFactory.deploy(
      timelock.address,
      signerAddress,
      0
    )) as AuctionPool;
    const auction = (await AuctionFactory.deploy(
      timelock.address,
      signerAddress,
      dai.address,
      malt.address,
      60 * 10, // 10 mins auction length
      stabilizerNode.address,
      maltDataLab.address,
      uniswapHandler.address,
      utils.parseEther('10') // 10 DAI early exit threshold
    )) as Auction;
    const escapeHatch = (await AuctionEscapeHatchFactory.deploy(
      timelock.address,
      signerAddress,
      auction.address,
      uniswapHandler.address,
      dai.address,
      malt.address,
    )) as AuctionEscapeHatch;
    const liquidityExtension = (await LiquidityExtensionFactory.deploy(
      timelock.address,
      signerAddress,
      auction.address,
      dai.address,
      malt.address,
      uniswapHandler.address,
      maltDataLab.address
    )) as LiquidityExtension;
    const burnReserveSkew = (await BurnReserveSkewFactory.deploy(
      timelock.address,
      signerAddress,
      stabilizerNode.address,
      auction.address,
      10,
    )) as AuctionBurnReserveSkew;
    const impliedCollateralService = (await ImpliedCollateralServiceFactory.deploy(
      timelock.address,
      signerAddress,
      dai.address,
      malt.address
    )) as ImpliedCollateralService;

    const rewardReinvestor = (await RewardReinvestorFactory.deploy(
      timelock.address,
      signerAddress,
      malt.address,
      dai.address,
      factory.address,
      treasuryAddress
    )) as RewardReinvestor;
    const miningService = (await MiningServiceFactory.deploy(
      timelock.address,
      signerAddress,
    )) as MiningService;
    const rewardDistributor = (await RewardDistributorFactory.deploy(
      timelock.address,
      signerAddress,
      dai.address,
    )) as RewardDistributor;
    const bonding = (await BondingFactory.deploy(
      timelock.address,
      signerAddress,
      malt.address,
      dai.address,
      lpTokenAddress,
      dao.address,
      miningService.address,
      uniswapHandler.address,
      maltDataLab.address,
      rewardDistributor.address
    )) as Bonding;

    const forfeitHandler = (await ForfeitHandlerFactory.deploy(
      timelock.address,
      signerAddress,
      dai.address,
      treasuryAddress
    )) as ForfeitHandler;
    const rewardOverflow = (await RewardOverflowPoolFactory.deploy(
      timelock.address,
      signerAddress,
    )) as RewardOverflowPool;
    const rewardThrottle = (await RewardThrottleFactory.deploy(
      timelock.address,
      signerAddress,
      dao.address,
      rewardOverflow.address,
      bonding.address,
      dai.address,
    )) as RewardThrottle;

    const transferVerification = (await PoolTransferVerificationFactory.deploy(
      timelock.address,
      signerAddress,
      1000, // 10% lower threshold
      200, // 2% upper threshold
      maltDataLab.address,
      30, // 30 seconds
      60 * 5, // 5 minutes
      lpTokenAddress,
      stabilizerNode.address,
      auction.address
    )) as PoolTransferVerification;

    const swingTrader = (await SwingTraderFactory.deploy(
      timelock.address,
      signerAddress,
      dai.address,
      malt.address,
      uniswapHandler.address,
      stabilizerNode.address,
      rewardThrottle.address
    )) as SwingTrader;

    const erc20Mine = (await ERC20VestedMineFactory.deploy(
      timelock.address,
      signerAddress,
      miningService.address,
      rewardDistributor.address,
      bonding.address,
      dai.address,
      0
    )) as ERC20VestedMine;

    let gasUsed = auction.deployTransaction.gasLimit;
    gasUsed = gasUsed.add(burnReserveSkew.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(escapeHatch.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(auctionPool.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(bonding.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(dao.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(erc20Mine.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(faucet.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(faucetTwo.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(forfeitHandler.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(impliedCollateralService.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(liquidityExtension.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(malt.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(dai.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(maltDataLab.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(miningService.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(maltPoolMA.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(transferVerification.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(rewardReinvestor.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(stabilizerNode.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(swingTrader.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(timelock.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(transferService.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(uniswapHandler.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(rewardDistributor.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(rewardOverflow.deployTransaction.gasLimit)
    gasUsed = gasUsed.add(rewardThrottle.deployTransaction.gasLimit)

    await factory.deployTransaction.wait();
    await weth.deployTransaction.wait();
    await router.deployTransaction.wait();
    await auction.deployTransaction.wait();
    await burnReserveSkew.deployTransaction.wait();
    await escapeHatch.deployTransaction.wait();
    await auctionPool.deployTransaction.wait();
    await bonding.deployTransaction.wait();
    await dao.deployTransaction.wait();
    await erc20Mine.deployTransaction.wait();
    await faucet.deployTransaction.wait();
    await faucetTwo.deployTransaction.wait();
    await forfeitHandler.deployTransaction.wait();
    await impliedCollateralService.deployTransaction.wait();
    await liquidityExtension.deployTransaction.wait();
    await maltDataLab.deployTransaction.wait();
    await miningService.deployTransaction.wait();
    await maltPoolMA.deployTransaction.wait();
    await transferVerification.deployTransaction.wait();
    await rewardReinvestor.deployTransaction.wait();
    await stabilizerNode.deployTransaction.wait();
    await swingTrader.deployTransaction.wait();
    await uniswapHandler.deployTransaction.wait();
    await rewardDistributor.deployTransaction.wait();
    await rewardOverflow.deployTransaction.wait();
    await rewardThrottle.deployTransaction.wait();

    console.log(`Total gas usage for deploy: ${gasUsed}`);

    // Use GAS_COST_GWEI as a benchmar
    const deployGasCost = gasUsed.mul(utils.parseUnits(GAS_COST_GWEI.toString(), 'gwei'));
    console.log(`Gas cost @ ${GAS_COST_GWEI}Gwei: ${utils.formatEther(deployGasCost)}`);

    const forfeitSwingTx = await forfeitHandler.setSwingTrader(swingTrader.address);

    const auctionPoolSetup = await auctionPool.setupContracts(
      auction.address,
      impliedCollateralService.address,
      bonding.address,
      miningService.address,
      swingTrader.address,
      dai.address
    );
    const auctionSetup = await auction.setupContracts(
      liquidityExtension.address,
      impliedCollateralService.address,
      burnReserveSkew.address,
      escapeHatch.address,
      auctionPool.address
    );
    const impliedCollateralSetup = await impliedCollateralService.setupContracts(
      auction.address,
      auctionPool.address,
      rewardOverflow.address,
      swingTrader.address,
      liquidityExtension.address,
      maltDataLab.address
    );
    const reinvestorSetup = await rewardReinvestor.setupContracts(
      uniswapHandler.address,
      bonding.address,
      miningService.address
    );
    const miningServiceSetup = await miningService.setupContracts(
      rewardReinvestor.address,
      bonding.address,
    );
    const overflowSetup = await rewardOverflow.setupContracts(
      rewardThrottle.address,
      auction.address,
      impliedCollateralService.address,
      dai.address
    );
    const distributorSetup = await rewardDistributor.setupContracts(
      erc20Mine.address,
      bonding.address,
      rewardThrottle.address,
      forfeitHandler.address,
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
      auctionPool.address
    );
    const maltSetup = await malt.initialSupplyControlSetup(
      [dao.address, escapeHatch.address, stabilizerNode.address, signerAddress],
      [liquidityExtension.address],
    );
    const daiSetup = await dai.initialSupplyControlSetup(
      [faucet.address],
      [],
    );

    const addVerifierTx = await transferService.addVerifier(lpTokenAddress, transferVerification.address);

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
    await daiSetup.wait();
    await addVerifierTx.wait();

    const daoMaltTokenTx = await dao.setMaltToken(
      malt.address,
      utils.parseEther('0'),
      constants.AddressZero,
    );
    const UPDATER_ROLE = utils.id("UPDATER_ROLE");
    const grantUpdaterTx = await maltPoolMA.grantRoleMultiple(
      UPDATER_ROLE,
      [maltDataLab.address]
    );

    const BUYER_ROLE = utils.id("BUYER_ROLE");
    const grantBuyerTx = await uniswapHandler.grantRoleMultiple(
      BUYER_ROLE,
      [
        rewardReinvestor.address,
        liquidityExtension.address,
        swingTrader.address
      ]
    );
    const SELLER_ROLE = utils.id("SELLER_ROLE");
    const grantSellerTx = await uniswapHandler.grantRoleMultiple(
      SELLER_ROLE,
      [
        escapeHatch.address,
        swingTrader.address,
        stabilizerNode.address,
      ]
    );
    const LIQUIDITY_ADDER_ROLE = utils.id("LIQUIDITY_ADDER_ROLE");
    const grantLiqAdderTx = await uniswapHandler.grantRole(
      LIQUIDITY_ADDER_ROLE,
      rewardReinvestor.address,
    );
    const LIQUIDITY_REMOVER_ROLE = utils.id("LIQUIDITY_REMOVER_ROLE");
    const grantLiqRemoverTx = await uniswapHandler.grantRole(
      LIQUIDITY_REMOVER_ROLE,
      bonding.address,
    );

    const dexTransferWhitelistTx = await transferVerification.addToWhitelist(uniswapHandler.address);
    const vestedMineAddTx = await miningService.addRewardMine(erc20Mine.address, 0);
    const auctionPoolAddTx = await miningService.addRewardMine(auctionPool.address, 0);

    await daoMaltTokenTx.wait();
    await dexTransferWhitelistTx.wait();
    await vestedMineAddTx.wait();
    await auctionPoolAddTx.wait();
    await grantBuyerTx.wait();
    await grantSellerTx.wait();
    await grantLiqAdderTx.wait();
    await grantLiqRemoverTx.wait();

    gasUsed = gasUsed.add(addVerifierTx.gasLimit)
    gasUsed = gasUsed.add(grantUpdaterTx.gasLimit)
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
    gasUsed = gasUsed.add(daiSetup.gasLimit)

    console.log(`Total gas usage: ${gasUsed}`);

    // Use GAS_COST_GWEI as a benchmar
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

      /* TESTNET FAUCETS */
      faucet: {
        address: faucet.address,
        artifacts: artifacts.readArtifactSync("TestFaucet"),
      },
      faucetTwo: {
        address: faucetTwo.address,
        artifacts: artifacts.readArtifactSync("TestFaucetTwo"),
      },

      /* UNISWAP AMM CONTRACTS */
      router: {
        address: router.address,
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
    if (existsSync('../launch')) {
      await promises.writeFile(
        `../launch/contracts.${network.name}.json`,
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

