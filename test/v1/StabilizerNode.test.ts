import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { Oracle } from "../type/Oracle";
import { LiquidityMine } from "../type/LiquidityMine";
import { StabilizerNode } from "../type/StabilizerNode";
import { Stabilizer } from "../type/Stabilizer";
import { AuctionBurnReserveSkew } from "../type/AuctionBurnReserveSkew";
import { MaltPoolPeriphery } from "../type/MaltPoolPeriphery";
import { Malt } from "../type/Malt";
import { ERC20 } from "../type/ERC20";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
// @ts-ignore
import { time } from "@openzeppelin/test-helpers";
import { hardhatSnapshot, hardhatRevert, increaseTime } from "./helpers";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import IDAOArtifacts from "../artifacts/contracts/interfaces/IDAO.sol/IDAO.json";
import IOracleArtifacts from "../artifacts/contracts/interfaces/IOracle.sol/IOracle.json";
import MaltArtifacts from "../artifacts/contracts/Malt.sol/Malt.json";
import { IDAO } from "../type/IDAO";
import { IOracle } from "../type/IOracle";
import { IAuction } from "../type/IAuction";
import UniswapV2RouterBuild from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import UniswapV2FactoryBuild from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETHBuild from "@uniswap/v2-periphery/build/WETH9.json";
import { ILiquidityMineReinvest } from "../type/ILiquidityMineReinvest";

const UniswapV2FactoryBytecode = UniswapV2FactoryBuild.bytecode;
const UniswapV2FactoryAbi = UniswapV2FactoryBuild.abi;

const UniswapV2RouterBytecode = UniswapV2RouterBuild.bytecode;
const UniswapV2RouterAbi = UniswapV2RouterBuild.abi;
const WETHBytecode = WETHBuild.bytecode;
const WETHAbi = WETHBuild.abi;

const { deployMockContract } = waffle;

describe("Stabilizer Node", function() {
  let accounts: Signer[];
  let owner: Signer;
  let stabilizer: Stabilizer;
  let treasury: Signer;
  let timelock: Signer;
  let mockDAO: IDAO;
  let lpmine: LiquidityMine;
  let auction: IAuction;
  let stabilizerNode: StabilizerNode;
  let burnReserveSkew: AuctionBurnReserveSkew;
  let maltPoolPeriphery: MaltPoolPeriphery;
  let lpmineReinvestor: ILiquidityMineReinvest;
  let dai: ERC20;
  let malt: ERC20;
  let LPToken: ERC20;
  let snapshotId: string;
  let epochLength = 60 * 30; // 30 minutes
  let oracle: Oracle;
  let router: any;
  let factory: any;
  let minReserveRatio = 20;
  let maxReservePledgeFactor = 10;
  let expansionDampingFactor = 1;
  let contractionDampingFactor = 2;
  let currentEpoch: number = 0;
  let genesisTime: number;

  let weth: Contract;
  const initialReserves = utils.parseEther('100000');
  const day = 60 * 60 * 24;
  const windowSize = 60 * 60; // 1 hour
  // const periods = 48; // every 30mins
  const periods = 2; // every 30mins
  let advanceOracle: any;

  async function buyMalt(amount: BigNumber, signer: Signer) {
    const to = await signer.getAddress();
    const path = [dai.address, malt.address];

    await dai.mint(to, amount);
    await dai.connect(signer).approve(router.address, amount);

    await router.connect(signer).swapExactTokensForTokens(amount, 0, path, to, new Date().getTime() + 10000);
  }

  async function sellMalt(amount: BigNumber, signer: Signer) {
    const to = await signer.getAddress();
    const path = [malt.address, dai.address];

    await malt.mint(to, amount);
    await malt.connect(signer).approve(router.address, amount);

    await router.connect(signer).swapExactTokensForTokens(amount, 0, path, to, new Date().getTime() + 10000);
  }

  async function addLiquidity(amountMalt: BigNumber, amountDai: BigNumber, reserveFactor: number = 0) {
    const ownerAddress = await owner.getAddress();

    await malt.mint(ownerAddress, amountMalt);
    await dai.mint(ownerAddress, amountDai);

    await malt.approve(router.address, amountMalt);
    await dai.approve(router.address, amountDai);

    const data = await router.addLiquidity(
      malt.address,
      dai.address,
      amountMalt,
      amountDai,
      amountMalt,
      amountDai,
      ownerAddress,
      new Date().getTime() + 10000,
    );

    if (reserveFactor > 0) {
      let initialReserves;

      if (reserveFactor >= 1) {
        initialReserves = amountDai.mul(2).div(reserveFactor);
      } else {
        initialReserves = amountDai.mul(2).mul(1 / reserveFactor);
      }

      await dai.mint(stabilizerNode.address, initialReserves);
    }

    // Advance enough periods to let moving average have enough data
    currentEpoch = await advanceOracle(periods + 1);
    await oracle.update(dai.address);
  }

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, treasury, timelock, ...accounts] = await ethers.getSigners();

    const ownerAddress = await owner.getAddress();
    const treasuryAddress = await treasury.getAddress();
    const timelockAddress = await timelock.getAddress();
    const MaltFactory = await ethers.getContractFactory("Malt");
    const OracleFactory = await ethers.getContractFactory("Oracle");
    const StabilizerFactory = await ethers.getContractFactory("Stabilizer");

    mockDAO = ((await deployMockContract(owner, IDAOArtifacts.abi)) as any) as IDAO;

    const factoryContract = new ContractFactory(UniswapV2FactoryAbi, UniswapV2FactoryBytecode, owner);
    factory = await factoryContract.deploy(constants.AddressZero);

    malt = (await MaltFactory.deploy("Malt Stablecoin", "MALT")) as Malt;

    const BurnReserveSkewFactory = await ethers.getContractFactory("AuctionBurnReserveSkew");
    const MaltPoolPeripheryFactory = await ethers.getContractFactory("MaltPoolPeriphery");

    const StabilizerNodeFactory = await ethers.getContractFactory("StabilizerNode");
    const AuctionFactory = await ethers.getContractFactory("AuctionBase");
    const LiquidityMineReinvestFactory = await ethers.getContractFactory("LiquidityMineReinvest");

    auction = (await AuctionFactory.deploy()) as IAuction;

    stabilizerNode = (await StabilizerNodeFactory.deploy()) as StabilizerNode;
    burnReserveSkew = (await BurnReserveSkewFactory.deploy()) as AuctionBurnReserveSkew;
    await burnReserveSkew.initialize(
      stabilizerNode.address,
      timelockAddress,
      10
    );

    dai = (await MaltFactory.deploy("Dai Stablecoin", "DAI")) as Malt;

    maltPoolPeriphery = (await MaltPoolPeripheryFactory.deploy()) as MaltPoolPeriphery;
    await maltPoolPeriphery.initialize(
      stabilizerNode.address,
      mockDAO.address,
      factory.address,
      malt.address,
      dai.address,
      utils.parseEther('1'), // $1
    );

    stabilizer = (await StabilizerFactory.deploy()) as Stabilizer;
    await stabilizer.initialize(ownerAddress, malt.address, timelockAddress, stabilizerNode.address, dai.address);

    await malt.initialize(ownerAddress, stabilizer.address, timelockAddress);
    await malt.deployed();

    await dai.initialize(ownerAddress, stabilizer.address, timelockAddress);
    await dai.deployed();

    oracle = (await OracleFactory.deploy()) as Oracle;

    await auction.initialize(
      stabilizerNode.address,
      maltPoolPeriphery.address,
      dai.address,
      malt.address,
      60 * 30, // 30 mins auction length
      ownerAddress
    );
    await auction.deployed();

    const reserveMin = utils.parseEther('1');

    await oracle.initialize(
      factory.address,
      mockDAO.address,
      windowSize,
      periods,
      malt.address,
      reserveMin,
      ownerAddress,
      dai.address
    );
    await oracle.deployed();

    const routerContract = new ContractFactory(UniswapV2RouterAbi, UniswapV2RouterBytecode, owner);
    const wethContract = new ContractFactory(WETHAbi, WETHBytecode, owner);
  
    weth = await wethContract.deploy();
    await weth.deployed();
    router = await routerContract.deploy(factory.address, weth.address);
    await router.deployed();

    let pair = await factory.getPair(malt.address, dai.address);

    LPToken = (new Contract(pair, IERC20.abi, owner)) as Malt;

    genesisTime = Math.floor(new Date().getTime() / 1000);
    await mockDAO.mock.epochLength.returns(epochLength);
    await mockDAO.mock.genesisTime.returns(genesisTime);

    await mockDAO.mock.getEpochStartTime.withArgs(51).returns(genesisTime + 51 * epochLength);
    await mockDAO.mock.getEpochStartTime.withArgs(53).returns(genesisTime + 53 * epochLength);

    const LPFactory = await ethers.getContractFactory("LiquidityMine");

    lpmine = (await LPFactory.deploy()) as LiquidityMine;
    await lpmine.deployed();

    await stabilizerNode.initialize(
      mockDAO.address,
      ownerAddress,
      stabilizer.address,
      lpmine.address,
      oracle.address,
      router.address,
      factory.address,
      malt.address,
      dai.address,
      treasuryAddress,
      auction.address
    );
    await stabilizerNode.deployed();
    await stabilizerNode.setAuctionBurnSkew(burnReserveSkew.address);
    await stabilizerNode.setNewPoolPeriphery(maltPoolPeriphery.address);

    await oracle.initializeNewTokenPair(dai.address);

    advanceOracle = oracleAdvancerFactory(oracle, dai.address, epochLength, mockDAO);

    lpmineReinvestor = (await LiquidityMineReinvestFactory.deploy()) as ILiquidityMineReinvest;

    await lpmineReinvestor.initialize(
      lpmine.address,
      mockDAO.address,
      malt.address,
      dai.address,
      maltPoolPeriphery.address,
      router.address,
      stabilizerNode.address,
      factory.address
    );

    await lpmine.initialize(
      dai.address,
      malt.address,
      LPToken.address,
      48,
      genesisTime,
      mockDAO.address,
      treasuryAddress,
      router.address,
      stabilizerNode.address,
      timelockAddress,
      lpmineReinvestor.address,
      constants.AddressZero
    );

    await lpmine.connect(timelock).setNewPoolPeriphery(maltPoolPeriphery.address);
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

   it("Has correct initial conditions", async function() {
     const ownerAddress = await owner.getAddress();

     expect(await stabilizerNode.dao()).to.equal(mockDAO.address);
     expect(await stabilizerNode.oracle()).to.equal(oracle.address);
     expect(await stabilizerNode.uniswapV2Factory()).to.equal(factory.address);
     expect(await stabilizerNode.router()).to.equal(router.address);
     expect(await stabilizerNode.treasuryMultisig()).to.equal(await treasury.getAddress());
     expect(await stabilizerNode.expansionDampingFactor()).to.equal(expansionDampingFactor);
     expect(await stabilizerNode.contractionDampingFactor()).to.equal(contractionDampingFactor);
     expect(await stabilizerNode.upperStabilityThreshold()).to.equal(utils.parseEther('0.01'));
     expect(await stabilizerNode.lowerStabilityThreshold()).to.equal(utils.parseEther('0.01'));
     expect(await auction.claimableArbitrageRewards()).to.equal(0);
     expect(await stabilizerNode.rewardToken()).to.equal(dai.address);
     expect(await stabilizerNode.malt()).to.equal(malt.address);
     expect(await stabilizerNode.totalRewardCut()).to.equal(1000);
     expect(await stabilizerNode.daoRewardCut()).to.equal(0);
     expect(await stabilizerNode.lpRewardCut()).to.equal(930);
     expect(await stabilizerNode.treasuryRewardCut()).to.equal(20);
     expect(await stabilizerNode.callerRewardCut()).to.equal(50);
     expect(await stabilizerNode.minReserveRatio()).to.equal(minReserveRatio);
     expect(await stabilizerNode.maxReservePledgeFactor()).to.equal(maxReservePledgeFactor);
   });

   it("does nothing when stablizer is called at peg", async function() {
     // Add equal liquidity
     let amountMalt = utils.parseEther('1000');
     let amountDai = utils.parseEther('1000');
     await addLiquidity(amountMalt, amountDai);
    
     await stabilizerNode.stabilize();

     // Assert no changes to reserves
     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();

     expect(maltReserves).to.equal(amountMalt);
     expect(daiReserves).to.equal(amountDai);

     let amountIn = 1000;

     const [price, valid] = await oracle.consult(dai.address, amountIn, malt.address);
    
     expect(valid).to.equal(true);
     expect(price).to.equal(amountIn);
   });

   it("brings price back inline when slightly above peg", async function() {
     // Add liquidity such that malt is priced higher
     let amountMalt = utils.parseEther('900');
     let amountDai = utils.parseEther('1100');
     await addLiquidity(amountMalt, amountDai);

     await stabilizerNode.stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();

     expect(maltReserves).to.be.above(amountMalt);
     expect(daiReserves).to.be.below(amountDai);
   });

   it("brings price back inline when significantly above peg", async function() {
     // Add liquidity such that malt is priced much higher
     let amountMalt = utils.parseEther('200');
     let amountDai = utils.parseEther('1800');
     await addLiquidity(amountMalt, amountDai);

     await stabilizerNode.stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();

     expect(maltReserves).to.be.above(amountMalt);
     expect(daiReserves).to.be.below(amountDai);
   });

   it("expansion rewards get distributed but lp is forfeited due to no bonding", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     const treasuryAddress = await treasury.getAddress();
     const ownerAddress = await owner.getAddress();
     const initialSupply = await malt.totalSupply();

     // Add liquidity such that malt is priced much higher
     let amountMalt = utils.parseEther('900');
     let amountDai = utils.parseEther('1100');
     await addLiquidity(amountMalt, amountDai);

     let callerBalance = await dai.balanceOf(userAddress);
     let lpMineBalance = await dai.balanceOf(lpmine.address);
     let daoBalance = await dai.balanceOf(mockDAO.address);
     let treasuryBalance = await dai.balanceOf(treasuryAddress);

     expect(callerBalance).to.equal(0);
     expect(lpMineBalance).to.equal(0);
     expect(daoBalance).to.gte(0);
     expect(treasuryBalance).to.equal(0);

     await stabilizerNode.connect(userAccount).stabilize();

     const subsequentSupply = await malt.totalSupply();

     callerBalance = await dai.balanceOf(userAddress);
     lpMineBalance = await dai.balanceOf(lpmine.address);
     daoBalance = await dai.balanceOf(mockDAO.address);
     treasuryBalance = await dai.balanceOf(treasuryAddress);

     expect(subsequentSupply).to.be.above(initialSupply);
     expect(callerBalance).to.be.above(0);
     // forfeited due to no bonding
     expect(lpMineBalance).to.equal(0);
     expect(treasuryBalance).to.be.above(0);
   });

   it("expansion rewards get distributed, including LP when there is bonding", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     const treasuryAddress = await treasury.getAddress();
     const ownerAddress = await owner.getAddress();
     const initialSupply = await malt.totalSupply();

     // Add liquidity such that malt is priced much higher
     let amountMalt = utils.parseEther('900');
     let amountDai = utils.parseEther('1100');
     await addLiquidity(amountMalt, amountDai);

     await mockDAO.mock.getEpochStartTime.withArgs(51).returns(genesisTime + 51 * epochLength);

     let callerBalance = await dai.balanceOf(userAddress);
     let lpMineBalance = await dai.balanceOf(lpmine.address);
     let daoBalance = await dai.balanceOf(mockDAO.address);
     let treasuryBalance = await dai.balanceOf(treasuryAddress);

     expect(callerBalance).to.equal(0);
     expect(lpMineBalance).to.equal(0);
     expect(daoBalance).to.gte(0);
     expect(treasuryBalance).to.equal(0);

     // Bond the LP so there is something to distribute rewards to
     let balance = utils.parseEther('1000');
     let depositAmount = await LPToken.balanceOf(ownerAddress);
     await LPToken.approve(lpmine.address, depositAmount);
     await lpmine.bond(depositAmount);

     await stabilizerNode.connect(userAccount).stabilize();

     const subsequentSupply = await malt.totalSupply();

     callerBalance = await dai.balanceOf(userAddress);
     lpMineBalance = await dai.balanceOf(lpmine.address);
     daoBalance = await dai.balanceOf(mockDAO.address);
     treasuryBalance = await dai.balanceOf(treasuryAddress);

     expect(subsequentSupply).to.be.above(initialSupply);
     expect(callerBalance).to.be.above(0);
     expect(lpMineBalance).to.be.above(0);
     expect(treasuryBalance).to.be.above(0);

     expect(lpMineBalance).to.be.above(daoBalance);
     expect(callerBalance).to.be.above(treasuryBalance);
   });

   it("creates an auction below peg", async function() {
     // Add liquidity such that malt is priced lower
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     let amountMalt = utils.parseEther('1100');
     let amountDai = utils.parseEther('900');
     await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
     const initialSupply = await malt.totalSupply();
     const [reserveRatio, _] = await maltPoolPeriphery.reserveRatio();

     let auctionId = await auction.currentAuctionId();

     let [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     expect(protocolReserveRatio).to.equal(utils.parseEther('0.5'));

     expect(await auction.auctionActive(auctionId)).to.equal(false);

     await stabilizerNode.connect(userAccount).stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
     const subsequentSupply = await malt.totalSupply();

     // Add the 100 malt incentive reward
     expect(subsequentSupply).to.be.below(initialSupply.add(utils.parseEther('100')));
     expect(maltReserves).to.be.below(amountMalt);
     expect(daiReserves).to.be.above(amountDai);

     let [
       commitments,
     ] = await auction.getAuctionCommitments(auctionId);

     let {
       startingPrice,
     } = await auction.getAuctionPrices(auctionId);

     expect(await auction.auctionActive(auctionId)).to.equal(true);
     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
     expect(commitments).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(startingPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);

     // Advance 1 epoch to end auction
     await advanceOracle(1);

     const finalPrice = utils.parseEther('1').sub(reserveRatio);

     let [
       commitmentsTwo,
     ] = await auction.getAuctionCommitments(auctionId);

     expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
     expect(commitmentsTwo).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(finalPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);
     expect(await auction.claimableArbitrageRewards()).to.equal(0);

     [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     // We depleted reserves but no auction buying replenished
     expect(protocolReserveRatio).to.be.below(utils.parseEther('0.5'));
   });
  
   it("creates an auction correctly with min reserve ratio", async function() {
     // Add liquidity such that malt is priced lower
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     let amountMalt = utils.parseEther('1100');
     let amountDai = utils.parseEther('900');
     await addLiquidity(amountMalt, amountDai, 100 / minReserveRatio); // initial reserveFactor
     const initialSupply = await malt.totalSupply();
     const [reserveRatio, _] = await maltPoolPeriphery.reserveRatio();

     let auctionId = await auction.currentAuctionId();

     const initialReserveRatio = (minReserveRatio / 100).toString();
     let [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     expect(protocolReserveRatio).to.equal(utils.parseEther(initialReserveRatio));

     expect(await auction.auctionActive(auctionId)).to.equal(false);

     await stabilizerNode.connect(userAccount).stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
     const subsequentSupply = await malt.totalSupply();

     // Suppy and reserves should be the same as reserve ratio is min so no eager burn happens
     expect(subsequentSupply).to.equal(initialSupply.add(utils.parseEther('100')));
     expect(maltReserves).to.equal(amountMalt);
     expect(daiReserves).to.equal(amountDai);

     let [
       commitments,
     ] = await auction.getAuctionCommitments(auctionId);

     let {
       startingPrice,
       endingPrice
     } = await auction.getAuctionPrices(auctionId);

     expect(await auction.auctionActive(auctionId)).to.equal(true);
     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
     expect(commitments).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(startingPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);

     // Don't save new epoch as want to assert against previous epoch
     await advanceOracle(1);

     let [
       commitmentsTwo,
     ] = await auction.getAuctionCommitments(auctionId);

     expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
     expect(commitmentsTwo).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(endingPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);
     expect(await auction.claimableArbitrageRewards()).to.equal(0);

     [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     // We did not deplete any reserves or do any burn so ratio should be same
     expect(protocolReserveRatio).to.equal(utils.parseEther(initialReserveRatio));
   });

   it("creates an auction correctly with 100% reserve ratio", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     // Add liquidity such that malt is priced lower
     let amountMalt = utils.parseEther('1100');
     let amountDai = utils.parseEther('900');
     await addLiquidity(amountMalt, amountDai, 1); // 100% reserve ratio
     const initialSupply = await malt.totalSupply();
     const [reserveRatio, _] = await maltPoolPeriphery.reserveRatio();

     let auctionId = await auction.currentAuctionId();

     expect(await auction.auctionActive(auctionId)).to.equal(false);

     let [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     expect(protocolReserveRatio).to.equal(utils.parseEther('1'));

     await stabilizerNode.connect(userAccount).stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
     const subsequentSupply = await malt.totalSupply();

     expect(subsequentSupply).to.be.below(initialSupply);
     expect(maltReserves).to.be.below(amountMalt);
     expect(daiReserves).to.be.above(amountDai);

     let [
       commitments,
     ] = await auction.getAuctionCommitments(auctionId);

     // 100% reserve ratio means no auction is created and protocol covers all buy/burn
     expect(await auction.auctionActive(auctionId)).to.equal(false);
     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
     expect(commitments).to.equal(0);
     await expect(auction.currentPrice(auctionId)).to.be.reverted;
     expect(await auction.unclaimedArbTokens()).to.equal(0);

    // Don't save new epoch as want to assert against previous epoch
    await advanceOracle(1);

    let [
      commitmentsTwo,
    ] = await auction.getAuctionCommitments(auctionId);

    expect(await auction.auctionActive(auctionId)).to.equal(false);
    expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
    expect(commitmentsTwo).to.equal(0);
    await expect(auction.currentPrice(auctionId)).to.be.reverted;
    expect(await auction.unclaimedArbTokens()).to.equal(0);
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
    // We depleted reserves but no auction buying replenished
    expect(protocolReserveRatio).to.be.below(utils.parseEther('1'));
   });

   it("creates an auction correctly with larger than 100% reserve ratio", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     // Add liquidity such that malt is priced lower
     let amountMalt = utils.parseEther('1100');
     let amountDai = utils.parseEther('900');
     await addLiquidity(amountMalt, amountDai, 0.5); // 200% reserve ratio
     const initialSupply = await malt.totalSupply();
     const [reserveRatio, _] = await maltPoolPeriphery.reserveRatio();
     let auctionId = await auction.currentAuctionId();

     expect(await auction.auctionActive(auctionId)).to.equal(false);

     let [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     expect(protocolReserveRatio).to.equal(utils.parseEther('2')); // 200%

     await stabilizerNode.connect(userAccount).stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
     const subsequentSupply = await malt.totalSupply();

     expect(subsequentSupply).to.be.below(initialSupply);
     expect(maltReserves).to.be.below(amountMalt);
     expect(daiReserves).to.be.above(amountDai);

     let [
       commitments,
     ] = await auction.getAuctionCommitments(auctionId);

     // 100% reserve ratio means no auction is created and protocol covers all buy/burn
     expect(await auction.auctionActive(auctionId)).to.equal(false);
     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
     expect(commitments).to.equal(0);
     await expect(auction.currentPrice(auctionId)).to.be.reverted;
     expect(await auction.unclaimedArbTokens()).to.equal(0);

     // Don't save new epoch as want to assert against previous epoch
     await advanceOracle(1);

     let [
       commitmentsTwo,
     ] = await auction.getAuctionCommitments(auctionId);

     expect(await auction.auctionActive(auctionId)).to.equal(false);
     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
     expect(commitmentsTwo).to.equal(0);
     await expect(auction.currentPrice(auctionId)).to.be.reverted;
     expect(await auction.unclaimedArbTokens()).to.equal(0);
     expect(await auction.claimableArbitrageRewards()).to.equal(0);

     [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     // We depleted reserves but no auction buying replenished
     expect(protocolReserveRatio).to.be.below(utils.parseEther('2'));
   });

   it("creates an auction correctly with less than min reserve ratio", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     // Add liquidity such that malt is priced lower
     let amountMalt = utils.parseEther('1100');
     let amountDai = utils.parseEther('900');
     await addLiquidity(amountMalt, amountDai, 100); // large factor == small reserve ratio
     const initialSupply = await malt.totalSupply();
     const [reserveRatio, _] = await maltPoolPeriphery.reserveRatio();

     const initialReserveRatio = (1 / 100).toString();
     let [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     expect(protocolReserveRatio).to.equal(utils.parseEther(initialReserveRatio));
     let auctionId = await auction.currentAuctionId();

     expect(await auction.auctionActive(auctionId)).to.equal(false);

     await stabilizerNode.connect(userAccount).stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
     const subsequentSupply = await malt.totalSupply();

     // Suppy and reserves should be the same as reserve ratio is min so no eager burn happens
     expect(subsequentSupply).to.equal(initialSupply.add(utils.parseEther('100')));
     expect(maltReserves).to.equal(amountMalt);
     expect(daiReserves).to.equal(amountDai);

     let [
       commitments,
     ] = await auction.getAuctionCommitments(auctionId);

     let {
       startingPrice,
       endingPrice
     } = await auction.getAuctionPrices(auctionId);

     expect(await auction.auctionActive(auctionId)).to.equal(true);
     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
     expect(commitments).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(startingPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);

     // Don't save new epoch as want to assert against previous epoch
     await advanceOracle(1);

     let [
       commitmentsTwo,
     ] = await auction.getAuctionCommitments(auctionId);

     expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
     expect(commitmentsTwo).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(endingPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);
     expect(await auction.claimableArbitrageRewards()).to.equal(0);

     [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     // We did not deplete any reserves or do any burn so ratio should be same
     expect(protocolReserveRatio).to.equal(utils.parseEther(initialReserveRatio));
   });

   it("creates an auction significantly below peg", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     // Add liquidity such that malt is priced lower
     let amountMalt = utils.parseEther('1800');
     let amountDai = utils.parseEther('300');
     await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
     const initialSupply = await malt.totalSupply();
     const [reserveRatio, _] = await maltPoolPeriphery.reserveRatio();

     let [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     expect(protocolReserveRatio).to.equal(utils.parseEther('0.5'));
     let auctionId = await auction.currentAuctionId();

     expect(await auction.auctionActive(auctionId)).to.equal(false);

     await stabilizerNode.connect(userAccount).stabilize();

     const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
     const subsequentSupply = await malt.totalSupply();

     // Add the incentive reward
     expect(subsequentSupply).to.be.below(initialSupply.add(utils.parseEther('100')));
     expect(maltReserves).to.be.below(amountMalt);
     expect(daiReserves).to.be.above(amountDai);

     let [
       commitments,
     ] = await auction.getAuctionCommitments(auctionId);

     let {
       startingPrice,
       endingPrice
     } = await auction.getAuctionPrices(auctionId);

     expect(await auction.auctionActive(auctionId)).to.equal(true);
     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);
     expect(commitments).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(startingPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);

     // Advance 1 epoch to end auction
     await advanceOracle(1);

     let [
       commitmentsTwo,
     ] = await auction.getAuctionCommitments(auctionId);

     expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
     expect(commitmentsTwo).to.equal(0);
     expect(await auction.currentPrice(auctionId)).to.equal(endingPrice);
     expect(await auction.unclaimedArbTokens()).to.equal(0);
     expect(await auction.claimableArbitrageRewards()).to.equal(0);

     [protocolReserveRatio, decimals] = await maltPoolPeriphery.reserveRatio();
     // There has been no replenishing of reserves so the ratio will have dropped
     expect(protocolReserveRatio).to.be.below(utils.parseEther('0.5'));
   });

   it("linearly reduces price of the auction", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     // Add liquidity such that malt is priced lower
     let amountMalt = utils.parseEther('1100');
     let amountDai = utils.parseEther('900');
     await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
     const initialSupply = await malt.totalSupply();

     await stabilizerNode.connect(userAccount).stabilize();

     let auctionId = await auction.currentAuctionId();

     let {
       startingPrice,
       endingPrice
     } = await auction.getAuctionPrices(auctionId);

     const diff = startingPrice.sub(endingPrice);

     expect(await auction.currentPrice(auctionId)).to.equal(startingPrice);

     // The Oracle update is needed to get time to actually move forward by writing to contracts
     await increaseTime(epochLength / 3);
     await oracle.update(dai.address);

     let price = await auction.currentPrice(auctionId);
     expect(price).to.be.lte(startingPrice.sub(diff.div(3)));
     expect(price).to.be.gte(startingPrice.sub(diff.mul(2).div(3)));

     await increaseTime(epochLength / 3);
     await oracle.update(dai.address);

     price = await auction.currentPrice(auctionId);
     expect(price).to.be.lte(startingPrice.sub(diff.mul(2).div(3).add(1)).add(1));
     expect(price).to.be.gte(endingPrice);

     await increaseTime(epochLength / 3);
     await oracle.update(dai.address);

     price = await auction.currentPrice(auctionId);
     expect(price).to.equal(endingPrice);
   });

   it("disallows buying arb tokens when there is no active auction", async function() {
     let amountMalt = utils.parseEther('1000');
     let amountDai = utils.parseEther('1000');
     await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

     let amount = 1000;
     await expect(stabilizerNode.purchaseArbitrageToken(amount)).to.be.reverted;
   });

   it("disallows buying arb tokens when there was a previous active auction", async function() {
     const userAccount = accounts[0];
     const userAddress = await userAccount.getAddress();
     // Add liquidity such that malt is priced lower
     let amountMalt = utils.parseEther('1100');
     let amountDai = utils.parseEther('900');
     await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
     let auctionId = await auction.currentAuctionId();

     await stabilizerNode.connect(userAccount).stabilize();

     expect(await auction.isAuctionFinished(auctionId)).to.equal(false);

     // Advance 1 epoch to end auction
     await advanceOracle(1);

     expect(await auction.isAuctionFinished(auctionId)).to.equal(true);

     let amount = 1000;
     await expect(stabilizerNode.purchaseArbitrageToken(amount)).to.be.reverted;
   });

   // TODO in previous tests assert against finalPrice? Fri 29 Jan 2021 18:56:42 GMT

  it("can pledge to active auction", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    const initialSupply = await malt.totalSupply();
    let auctionId = await auction.currentAuctionId();

    await stabilizerNode.connect(userAccount).stabilize();

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // The protocol buys and burns some malt immediately to stabilize
    expect(stabilizedMaltReserves).to.be.below(amountMalt);
    expect(stabilizedDaiReserves).to.be.above(amountDai);
    expect(stabilizedSupply).to.be.below(initialSupply.add(utils.parseEther('100')));
    expect(await auction.isAuctionFinished(auctionId)).to.equal(false);

    // Purchase 1 dai of arb tokens
    let amount = utils.parseEther('1');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    // Purchasing arb tokens should have bought and burned some Malt
    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    // No burning will be done as only 1 dai purchased will go
    // towards replenishing the eager reserve purchasing
    expect(auctionedMaltReserves).to.equal(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.equal(stabilizedDaiReserves);
    expect(auctionedSupply).to.equal(stabilizedSupply);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    let [
      commitments,
    ] = await auction.getAuctionCommitments(auctionId);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(arbTokens).to.be.above(0);
    expect(commitments).to.equal(amount);
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);

    // Unclaimed is still zero as this only generates at the end of auction
    expect(await auction.unclaimedArbTokens()).to.equal(0);

    // Move forward to end of auction without advancing epoch
    await increaseTime(epochLength);
    await oracle.update(dai.address);

    // This is like the DAO calling stabilize before advancing the epoch.
    // It officially ends the auction and does any extra stabilizing required
    await stabilizerNode.connect(userAccount).stabilize();

    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    let {
      startingPrice,
      endingPrice,
      finalPrice
    } = await auction.getAuctionPrices(auctionId);

    // Now unclaimed balance is correct
    expect(await auction.unclaimedArbTokens()).to.equal(amount.mul(utils.parseEther('1')).div(endingPrice)); 
    expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
    expect(await auction.auctionActive(auctionId)).to.equal(false);

    const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
    const subsequentSupply = await malt.totalSupply();

    // Protocol started a new auction and will have bought and burned even more malt
    expect(maltReserves).to.be.below(auctionedMaltReserves);
    expect(daiReserves).to.be.above(auctionedDaiReserves);
    // add 100 malt reward
    expect(subsequentSupply).to.be.below(auctionedSupply.add(utils.parseEther('100')));

    let [
      commitmentsTwo,
    ] = await auction.getAuctionCommitments(newAuctionId);

    expect(await auction.auctionActive(newAuctionId)).to.equal(true);
    expect(await auction.isAuctionFinished(newAuctionId)).to.equal(false);
    expect(commitmentsTwo).to.equal(0);
    expect(await auction.currentPrice(newAuctionId)).to.be.below(utils.parseEther('1'));

    // Same as before
    expect(await auction.unclaimedArbTokens()).to.equal(utils.parseEther('2')); 
    expect(await auction.claimableArbitrageRewards()).to.equal(0);
  });

  it("corrects price when auction is fully subscribed", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);
    let auctionId = await auction.currentAuctionId();

    // Purchasing arb tokens should have bought and burned some Malt
    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    expect(auctionedMaltReserves).to.be.below(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.be.above(stabilizedDaiReserves);
    expect(auctionedSupply).to.be.below(stabilizedSupply);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    let [
      commitments,
      maxCommitments
    ] = await auction.getAuctionCommitments(auctionId);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(arbTokens).to.be.above(0);
    expect(commitments).to.equal(amount);
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);

    const auctionPrice = await auction.currentPrice(auctionId);
    const tokens = amount.mul(utils.parseEther('1')).div(auctionPrice);

    // Enough was pledged to end the auction early
    expect(await auction.unclaimedArbTokens()).to.equal(tokens);
    expect(auctionPrice).to.be.above(utils.parseEther('0.95'));
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);

    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);

    const [price, decimals] = await maltPoolPeriphery.maltMarketPrice();

    expect(price).to.be.above(utils.parseEther('0.97'))

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    // TODO check how the eager depletion gets done / fulfilled Sat 30 Jan 2021 22:14:50 GMT

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("corrects price when auction is fully subscribed after time", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    // Move to near the end of auction
    await increaseTime(epochLength * 0.95);
    await oracle.update(dai.address);

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);
    let auctionId = await auction.currentAuctionId();

    // Purchasing arb tokens should have bought and burned some Malt
    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    expect(auctionedMaltReserves).to.be.below(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.be.above(stabilizedDaiReserves);
    expect(auctionedSupply).to.be.below(stabilizedSupply);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    let [
      commitments,
      maxCommitments
    ] = await auction.getAuctionCommitments(auctionId);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(arbTokens).to.be.above(0);
    expect(commitments).to.equal(amount);
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);

    const auctionPrice = await auction.currentPrice(auctionId);
    const tokens = amount.mul(utils.parseEther('1')).div(auctionPrice);

    // Enough was pledged to end the auction early
    expect(await auction.unclaimedArbTokens()).to.equal(tokens);
    expect(auctionPrice).to.be.below(utils.parseEther('0.6'));
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    const [price, decimals] = await maltPoolPeriphery.maltMarketPrice();

    expect(price).to.be.above(utils.parseEther('0.97'))

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    // TODO check how the eager depletion gets done / fulfilled Sat 30 Jan 2021 22:14:50 GMT

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("Can handle auction only half way to full raise", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // Roughly half way between the initial reserve pledge and full raise
    let amount = utils.parseEther('35');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);
    let auctionId = await auction.currentAuctionId();

    // Purchasing arb tokens should have bought and burned some Malt
    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    expect(auctionedMaltReserves).to.be.below(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.be.above(stabilizedDaiReserves);
    expect(auctionedSupply).to.be.below(stabilizedSupply);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    let [
      commitments,
    ] = await auction.getAuctionCommitments(auctionId);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(arbTokens).to.be.above(0);
    expect(commitments).to.equal(amount);
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);

    // Unclaimed is still zero as this only generates at the end of auction
    expect(await auction.unclaimedArbTokens()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Get final price of initial auction
    const auctionPrice = await auction.currentPrice(auctionId);
    const tokens = amount.mul(utils.parseEther('1')).div(auctionPrice);

    // Now unclaimed balance is correct
    // Final auction price was 0.5 therefore 1 dai bought 2 tokens
    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
    expect(await auction.auctionActive(auctionId)).to.equal(false);

    const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
    const subsequentSupply = await malt.totalSupply();

    // Protocol started a new auction and will have bought and burned even more malt
    expect(maltReserves).to.be.below(auctionedMaltReserves);
    expect(daiReserves).to.be.above(auctionedDaiReserves);
    // Add 100 malt reward
    expect(subsequentSupply).to.be.below(auctionedSupply.add(utils.parseEther('100')));

    let [
      commitmentsTwo,
    ] = await auction.getAuctionCommitments(newAuctionId);

    // Another auction should have been started
    expect(await auction.auctionActive(newAuctionId)).to.equal(true);
    expect(await auction.isAuctionFinished(newAuctionId)).to.equal(false);
    expect(commitmentsTwo).to.equal(0);
    expect(await auction.currentPrice(newAuctionId)).to.be.below(utils.parseEther('1'));

    // Same as before
    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    const[price, decimals] = await maltPoolPeriphery.maltMarketPrice();

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("Can handle auction that only covers the initial reserve pledge", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // This is exactly the initial pledge the reserve makes to the auction
    let amount = utils.parseEther('35.165');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    // Purchasing arb tokens should have bought and burned some Malt
    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    expect(auctionedMaltReserves).to.be.below(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.be.above(stabilizedDaiReserves);
    expect(auctionedSupply).to.be.below(stabilizedSupply);
    let auctionId = await auction.currentAuctionId();

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    let [
      commitments,
    ] = await auction.getAuctionCommitments(auctionId);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(arbTokens).to.be.above(0);
    expect(commitments).to.equal(amount);
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);

    // Unclaimed is still zero as this only generates at the end of auction
    expect(await auction.unclaimedArbTokens()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Get final price of initial auction
    const auctionPrice = await auction.currentPrice(auctionId);
    const tokens = amount.mul(utils.parseEther('1')).div(auctionPrice);

    // Now unclaimed balance is correct
    // Final auction price was 0.5 therefore 1 dai bought 2 tokens
    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
    expect(await auction.auctionActive(auctionId)).to.equal(false);

    const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
    const subsequentSupply = await malt.totalSupply();

    // Protocol started a new auction and will have bought and burned even more malt
    expect(maltReserves).to.be.below(auctionedMaltReserves);
    expect(daiReserves).to.be.above(auctionedDaiReserves);
    // Add 100 malt reward
    expect(subsequentSupply).to.be.below(auctionedSupply.add(utils.parseEther('100')));

    let [
      commitmentsTwo,
    ] = await auction.getAuctionCommitments(newAuctionId);

    // Another auction should have been started
    expect(await auction.auctionActive(newAuctionId)).to.equal(true);
    expect(await auction.isAuctionFinished(newAuctionId)).to.equal(false);
    expect(commitmentsTwo).to.equal(0);
    expect(await auction.currentPrice(newAuctionId)).to.be.below(utils.parseEther('1'));

    // Same as before
    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("Can handle auction that raises less than initial pledge", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // This much lower than the initial pledge made by the protocol
    let amount = utils.parseEther('10');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    // This pledge is less than reserve initial and therefore it won't
    // be used to burn any supply and will just replenish reserves
    expect(auctionedMaltReserves).to.equal(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.equal(stabilizedDaiReserves);
    expect(auctionedSupply).to.equal(stabilizedSupply);
    
    let auctionId = await auction.currentAuctionId();

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    let [
      commitments,
    ] = await auction.getAuctionCommitments(auctionId);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(arbTokens).to.be.above(0);
    expect(commitments).to.equal(amount);
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);

    // Unclaimed is still zero as this only generates at the end of auction
    expect(await auction.unclaimedArbTokens()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Get final price of initial auction
    const auctionPrice = await auction.currentPrice(auctionId);
    const tokens = amount.mul(utils.parseEther('1')).div(auctionPrice);

    // Now unclaimed balance is correct
    // Final auction price was 0.5 therefore 1 dai bought 2 tokens
    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
    expect(await auction.auctionActive(auctionId)).to.equal(false);

    const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
    const subsequentSupply = await malt.totalSupply();

    // Protocol started a new auction and will have bought and burned even more malt
    expect(maltReserves).to.be.below(auctionedMaltReserves);
    expect(daiReserves).to.be.above(auctionedDaiReserves);
    // add 100 malt reward
    expect(subsequentSupply).to.be.below(auctionedSupply.add(utils.parseEther('100')));

    let [
      commitmentsTwo,
    ] = await auction.getAuctionCommitments(newAuctionId);

    // Another auction should have been started
    expect(await auction.auctionActive(newAuctionId)).to.equal(true);
    expect(await auction.isAuctionFinished(newAuctionId)).to.equal(false);
    expect(commitmentsTwo).to.equal(0);
    expect(await auction.currentPrice(newAuctionId)).to.be.below(utils.parseEther('1'));

    // Same as before
    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("Can handle a user trying to pledge more than desired raise", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    // Move to near the end of auction
    await increaseTime(epochLength * 0.95);
    await oracle.update(dai.address);

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // Way more than the auciton requires
    let amount = utils.parseEther('10000');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);
    let auctionId = await auction.currentAuctionId();

    // Purchasing arb tokens should have bought and burned some Malt
    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    expect(auctionedMaltReserves).to.be.below(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.be.above(stabilizedDaiReserves);
    expect(auctionedSupply).to.be.below(stabilizedSupply);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(arbTokens).to.be.above(0);

    let [
      commitments,
      maxCommitments
    ] = await auction.getAuctionCommitments(auctionId);

    const realAmount = utils.parseEther('46.887580194532172099');
    // This is not the full amount of dai pledged but is instead the maximum wanted
    // by the auction
    expect(commitments).to.equal(realAmount);
    // The full amount is not taken.
    expect(await dai.balanceOf(ownerAddress)).to.be.above(0);

    const auctionPrice = await auction.currentPrice(auctionId);
    const tokens = realAmount.mul(utils.parseEther('1')).div(auctionPrice);

    // Enough was pledged to end the auction early
    expect(await auction.unclaimedArbTokens()).to.equal(tokens);
    expect(auctionPrice).to.be.below(utils.parseEther('0.6'));
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    const [price, decimals] = await maltPoolPeriphery.maltMarketPrice();

    expect(price).to.be.above(utils.parseEther('0.97'));

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    // TODO check how the eager depletion gets done / fulfilled Sat 30 Jan 2021 22:14:50 GMT

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("handles when pledging less than $1 to an auction", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // Attempt to pledge less than 1
    let amount = utils.parseEther('0.1');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);
    let auctionId = await auction.currentAuctionId();

    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();

    expect(auctionedMaltReserves).to.equal(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.equal(stabilizedDaiReserves);
    expect(auctionedSupply).to.equal(stabilizedSupply);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    let [
      commitments,
    ] = await auction.getAuctionCommitments(auctionId);

    expect(arbTokens).to.be.above(0);
    expect(commitments).to.equal(amount);
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);
    expect(await auction.unclaimedArbTokens()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Get final price of initial auction
    const auctionPrice = await auction.currentPrice(auctionId);
    const tokens = amount.mul(utils.parseEther('1')).div(auctionPrice);

    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.isAuctionFinished(auctionId)).to.equal(true);
    expect(await auction.auctionActive(auctionId)).to.equal(false);

    const [maltReserves, daiReserves] = await maltPoolPeriphery.reserves();
    const subsequentSupply = await malt.totalSupply();

    // Protocol started a new auction and will have bought and burned even more malt
    expect(maltReserves).to.be.below(auctionedMaltReserves);
    expect(daiReserves).to.be.above(auctionedDaiReserves);
    // Add 100 malt reward
    expect(subsequentSupply).to.be.below(auctionedSupply.add(utils.parseEther('100')));

    let [
      commitmentsTwo,
    ] = await auction.getAuctionCommitments(newAuctionId);

    // Another auction should have been started
    expect(await auction.auctionActive(newAuctionId)).to.equal(true);
    expect(await auction.isAuctionFinished(newAuctionId)).to.equal(false);
    expect(commitmentsTwo).to.equal(0);
    expect(await auction.currentPrice(newAuctionId)).to.be.below(utils.parseEther('1'));

    // Same as before
    expect(await auction.unclaimedArbTokens()).to.equal(tokens); 
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("handles multiple users pledging", async function() {
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();
    const ownerAddress = await owner.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    // Move to near the end of auction
    await increaseTime(epochLength * 0.95);
    await oracle.update(dai.address);

    const [stabilizedMaltReserves, stabilizedDaiReserves] = await maltPoolPeriphery.reserves();
    const stabilizedSupply = await malt.totalSupply();

    // This is the exact amount of dai required by this auction
    let amountOne = utils.parseEther('26.887580194532172099');
    await dai.mint(ownerAddress, amountOne);
    await dai.approve(stabilizerNode.address, amountOne);

    await stabilizerNode.purchaseArbitrageToken(amountOne);

    let amountTwo = utils.parseEther('20');
    await dai.mint(userAddress, amountTwo);
    await dai.connect(userAccount).approve(stabilizerNode.address, amountTwo);

    await stabilizerNode.connect(userAccount).purchaseArbitrageToken(amountOne);

    // Purchasing arb tokens should have bought and burned some Malt
    const [auctionedMaltReserves, auctionedDaiReserves] = await maltPoolPeriphery.reserves();
    const auctionedSupply = await malt.totalSupply();
    let auctionId = await auction.currentAuctionId();

    expect(auctionedMaltReserves).to.be.below(stabilizedMaltReserves);
    expect(auctionedDaiReserves).to.be.above(stabilizedDaiReserves);
    expect(auctionedSupply).to.be.below(stabilizedSupply);

    const ownerArbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);
    const userArbTokens = await auction.balanceOfArbTokens(auctionId, userAddress);

    let [
      commitments,
      maxCommitments
    ] = await auction.getAuctionCommitments(auctionId);

    // The number of arb tokens isn't locked down in until end of auction
    // The current balance will be determined by current auction price
    expect(ownerArbTokens).to.be.above(0);
    expect(userArbTokens).to.be.above(0);
    expect(commitments).to.equal(amountOne.add(amountTwo));
    // The full amount is used
    expect(await dai.balanceOf(ownerAddress)).to.equal(0);
    expect(await dai.balanceOf(userAddress)).to.equal(0);

    const auctionPrice = await auction.currentPrice(auctionId);
    const ownerTokens = amountOne.mul(utils.parseEther('1')).div(auctionPrice);
    const userTokens = amountTwo.mul(utils.parseEther('1')).div(auctionPrice);

    const totalTokens = ownerTokens.add(userTokens);
    // Enough was pledged to end the auction early
    expect(await auction.unclaimedArbTokens()).to.be.gte(totalTokens.sub(1));
    expect(await auction.unclaimedArbTokens()).to.be.lte(totalTokens.add(1));
    expect(auctionPrice).to.be.below(utils.parseEther('0.6'));
    expect(await auction.claimableArbitrageRewards()).to.equal(0);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    const [price, decimals] = await maltPoolPeriphery.maltMarketPrice();

    expect(price).to.be.above(utils.parseEther('0.97'))

    const [finalReserveRatio, ...r] = await maltPoolPeriphery.reserveRatio();

    // TODO check how the eager depletion gets done / fulfilled Sat 30 Jan 2021 22:14:50 GMT

    // TODO assert against reserve ratio Sat 30 Jan 2021 20:05:12 GMT
    // console.log(initialReserveRatio.toString(), finalReserveRatio.toString());
  });

  it("it splits expansion rewards between arb tokens and other rewards", async function() {
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();
    const treasuryAddress = await treasury.getAddress();
    const ownerAddress = await owner.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();
    let auctionId = await auction.currentAuctionId();

    // Bond the LP so there is something to distribute rewards to
    let balance = utils.parseEther('1000');
    let depositAmount = await LPToken.balanceOf(ownerAddress);
    await LPToken.approve(lpmine.address, depositAmount);
    await lpmine.bond(depositAmount);

    await mockDAO.mock.getEpochStartTime.withArgs(52).returns(genesisTime + 52 * epochLength);

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Buy to move price up then stabilize to cover arb tokens
    await buyMalt(utils.parseEther('100'), owner);
    await advanceOracle(2);

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the total dai rewarded by the stabilizer in the current setup
    const totalRewarded = utils.parseEther('69.254843005042868644');

    // 70% of total reward
    expect(await auction.claimableArbitrageRewards()).to.be.above(totalRewarded.mul(69).div(100));
    expect(await auction.claimableArbitrageRewards()).to.be.below(totalRewarded.mul(71).div(100));

    const callerBalance = await dai.balanceOf(userAddress);
    const lpMineBalance = await dai.balanceOf(lpmine.address);
    const daoBalance = await dai.balanceOf(mockDAO.address);
    const treasuryBalance = await dai.balanceOf(treasuryAddress);

    expect(callerBalance).to.be.above(0);
    expect(lpMineBalance).to.be.above(0);
    expect(treasuryBalance).to.be.above(0);

    expect(callerBalance).to.be.above(treasuryBalance);

    const distributed = callerBalance.add(lpMineBalance).add(daoBalance).add(treasuryBalance);

    // 30% of total reward
    expect(distributed).to.be.above(totalRewarded.mul(29).div(100));
    expect(distributed).to.be.below(totalRewarded.mul(31).div(100));
  });

  it("distributes all expansion rewards when arb tokens are replenished", async function() {
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();
    const treasuryAddress = await treasury.getAddress();
    const ownerAddress = await owner.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Buy to move price up then stabilize to cover arb tokens
    await buyMalt(utils.parseEther('500'), owner);
    await advanceOracle(1);

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the total dai rewarded by the stabilizer in the current setup
    const totalRewarded = utils.parseEther('388.961827190640022487');

    expect(await auction.claimableArbitrageRewards()).to.equal(arbTokens);

    const callerBalance = await dai.balanceOf(userAddress);
    const lpMineBalance = await dai.balanceOf(lpmine.address);
    const daoBalance = await dai.balanceOf(mockDAO.address);
    const treasuryBalance = await dai.balanceOf(treasuryAddress);

    const distributed = callerBalance.add(lpMineBalance).add(daoBalance).add(treasuryBalance);

    expect(distributed).to.be.equal(totalRewarded.sub(arbTokens));
  });

  it("allows a user to redeem all arb tokens when available", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Buy to move price up then stabilize to cover arb tokens
    await buyMalt(utils.parseEther('500'), owner);
    await advanceOracle(10);

    await stabilizerNode.connect(userAccount).stabilize();

    let initialBalance = await dai.balanceOf(ownerAddress);

    await stabilizerNode.claimArbitrage(auctionId);

    let finalBalance = await dai.balanceOf(ownerAddress);

    expect(finalBalance.sub(initialBalance)).to.equal(arbTokens);

    expect(await auction.claimableArbitrageRewards()).to.equal(0);
    expect(await auction.unclaimedArbTokens()).to.equal(0);

    const finalArbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    // To account for any numerical error
    expect(finalArbTokens).to.be.below(10);
  });

  it("allows a user to partially redeem some arb tokens when available", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Buy to move price up then stabilize to cover arb tokens
    await buyMalt(utils.parseEther('100'), owner);
    await advanceOracle(10);
    await oracle.update(dai.address);

    await stabilizerNode.connect(userAccount).stabilize();

    let initialBalance = await dai.balanceOf(ownerAddress);

    await stabilizerNode.claimArbitrage(auctionId);

    let finalBalance = await dai.balanceOf(ownerAddress);

    // Some reward was withdrawn
    let rewardWithdrawn = finalBalance.sub(initialBalance);
    expect(rewardWithdrawn).to.be.above(0);

    const finalArbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    // Numerical error
    expect(await auction.claimableArbitrageRewards()).to.lte(10);
    expect(await auction.unclaimedArbTokens()).to.be.gte(finalArbTokens.sub(1));
    expect(await auction.unclaimedArbTokens()).to.be.lte(finalArbTokens.add(1));

    expect(finalArbTokens).to.be.gte(arbTokens.sub(rewardWithdrawn).sub(1));
    expect(finalArbTokens).to.be.lte(arbTokens.sub(rewardWithdrawn).add(1));
  });

  it("disallows redemption of arb tokens for epoch without rewards", async function() {
    const ownerAddress = await owner.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    let initialBalance = await dai.balanceOf(ownerAddress);

    await expect(stabilizerNode.claimArbitrage(auctionId)).to.be.reverted;

    let finalBalance = await dai.balanceOf(ownerAddress);

    expect(initialBalance).to.equal(finalBalance);
    expect(await auction.claimableArbitrageRewards()).to.equal(0);
    expect(await auction.unclaimedArbTokens()).to.equal(0);
  });

  it("disallows redemption of arb tokens before they are available", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    await stabilizerNode.purchaseArbitrageToken(amount);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);
    await stabilizerNode.connect(userAccount).stabilize();
    let newAuctionId = auctionId.add(1);
    await oracle.update(dai.address);

    // Buy to move price up then stabilize to cover arb tokens
    await buyMalt(utils.parseEther('100'), owner);
    await advanceOracle(10);

    let initialBalance = await dai.balanceOf(ownerAddress);

    await expect(stabilizerNode.claimArbitrage(auctionId)).to.be.reverted;

    let finalBalance = await dai.balanceOf(ownerAddress);

    expect(finalBalance).to.equal(initialBalance);

    expect(await auction.claimableArbitrageRewards()).to.equal(0);
    expect(await auction.unclaimedArbTokens()).to.equal(arbTokens);

    const finalArbTokens = await auction.balanceOfArbTokens(auctionId, ownerAddress);
    expect(finalArbTokens).to.equal(arbTokens);
  });

  it("allows redemption of arb tokens for epochs that are covered but disallows others", async function() {
    const ownerAddress = await owner.getAddress();
    const userOneAccount = accounts[0];
    const userOneAddress = await userOneAccount.getAddress();
    const userTwoAccount = accounts[1];
    const userTwoAddress = await userTwoAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    // Trigger first auction
    await stabilizerNode.connect(userOneAccount).stabilize();

    // Some amount larger than required
    let amount = utils.parseEther('50');
    await dai.mint(userOneAddress, amount);
    await dai.connect(userOneAccount).approve(stabilizerNode.address, amount);

    // Pledge to auction
    await stabilizerNode.connect(userOneAccount).purchaseArbitrageToken(amount);

    const arbTokens = await auction.balanceOfArbTokens(auctionId, userOneAddress);

    /*
     * Move time forward, stabilize (which also ends current auction and starts a new one if needed)
     * then advance epoch
     */
    await increaseTime(epochLength);
    await oracle.update(dai.address);

    // Finalize auction and trigger second auction
    await stabilizerNode.connect(userOneAccount).stabilize();

    // await oracle.update(dai.address);

    // // Sell to put price back below peg
    // await sellMalt(utils.parseEther('100'), owner);

    // Move forward in the epoch
    await increaseTime(epochLength / 3);
    await oracle.update(dai.address);

    // 
    // await stabilizerNode.connect(userOneAccount).stabilize();

    // Purchase tokens from second auction
    let auctionIdTwo = auctionId.add(1);
    let amountTwo = utils.parseEther('50');
    await dai.mint(userTwoAddress, amountTwo);
    await dai.connect(userTwoAccount).approve(stabilizerNode.address, amountTwo);

    await stabilizerNode.connect(userTwoAccount).purchaseArbitrageToken(amount);

    const arbTokensTwo = await auction.balanceOfArbTokens(auctionIdTwo, userTwoAddress);

    // Finalize auction
    await stabilizerNode.connect(userOneAccount).stabilize();
    await advanceOracle(2);

    let {
      startingPrice,
      endingPrice,
    } = await auction.getAuctionPrices(auctionId);

    // Buy to move price up then stabilize to cover arb tokens
    await buyMalt(utils.parseEther('500'), owner);
    await advanceOracle(10);
    await stabilizerNode.connect(userOneAccount).stabilize();

    await expect(stabilizerNode.connect(userTwoAccount).claimArbitrage(auctionIdTwo)).to.be.reverted;
    await expect(stabilizerNode.connect(userTwoAccount).claimArbitrage(auctionId)).to.be.reverted;

    let initialBalance = await dai.balanceOf(userOneAddress);
    await expect(stabilizerNode.connect(userOneAccount).claimArbitrage(auctionIdTwo)).to.be.reverted;
    await stabilizerNode.connect(userOneAccount).claimArbitrage(auctionId);
    let finalBalance = await dai.balanceOf(userOneAddress);

    expect(finalBalance.sub(initialBalance)).to.equal(arbTokens);

    expect(await auction.claimableArbitrageRewards()).to.equal(0);
    expect(await auction.unclaimedArbTokens()).to.be.above(utils.parseEther('8.24'));
    expect(await auction.unclaimedArbTokens()).to.be.below(utils.parseEther('8.25'));

    const finalArbTokensOne = await auction.balanceOfArbTokens(auctionId, userOneAddress);
    const finalArbTokensTwo = await auction.balanceOfArbTokens(auctionIdTwo, userTwoAddress);

    // To account for any numerical error
    expect(finalArbTokensOne).to.be.below(10);
    expect(finalArbTokensTwo).to.be.above(utils.parseEther('5'));
  });

  it("collateralizes itself when below min reserve ratio in expansion", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced higher
    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('1100');
    await addLiquidity(amountMalt, amountDai); // no 3rd arg means no reserves

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    expect(initialReserveRatio).to.equal(0);

    await stabilizerNode.connect(userAccount).stabilize();

    const [finalReserveRatio, r] = await maltPoolPeriphery.reserveRatio();
    
    expect(finalReserveRatio).to.be.above(0);
  });

  it("reduces large reserve ratio in expansion", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced higher
    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('1100');
    await addLiquidity(amountMalt, amountDai, 2); // 50% reserve ratio

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    expect(initialReserveRatio).to.equal(utils.parseEther('0.5'));

    let initialBalance = await dai.balanceOf(stabilizerNode.address);

    await stabilizerNode.connect(userAccount).stabilize();

    let finalBalance = await dai.balanceOf(stabilizerNode.address);

    const [finalReserveRatio, r] = await maltPoolPeriphery.reserveRatio();
    
    expect(finalBalance).to.be.above(initialBalance);
    expect(finalReserveRatio).to.be.above(utils.parseEther((minReserveRatio / 100).toString()));
  });

  it("maintains min reserve ratio in expansion", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced higher
    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('1100');
    await addLiquidity(amountMalt, amountDai, 5); // 20% reserve ratio - minimum

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    expect(initialReserveRatio).to.equal(utils.parseEther('0.2'));

    let initialBalance = await dai.balanceOf(stabilizerNode.address);

    await stabilizerNode.connect(userAccount).stabilize();

    let finalBalance = await dai.balanceOf(stabilizerNode.address);

    const [finalReserveRatio, r] = await maltPoolPeriphery.reserveRatio();
    
    expect(finalBalance).to.be.above(initialBalance);
    expect(finalReserveRatio).to.be.above(utils.parseEther((minReserveRatio / 100).toString()));
  });

  it("distributes rewards when reserve ratio is 100% in expansion", async function() {
    // We do not want to get trapped at 100% ratio so there is a cap on the ratio
    // in expansion to ensure some rewards get distributed
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();
    const treasuryAddress = await treasury.getAddress();

    // Add liquidity such that malt is priced higher
    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('1100');
    await addLiquidity(amountMalt, amountDai, 1); // 100% reserve ratio

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();

    expect(initialReserveRatio).to.equal(utils.parseEther('1'));

    // Bond the LP so there is something to distribute rewards to
    let balance = utils.parseEther('1000');
    let depositAmount = await LPToken.balanceOf(ownerAddress);
    await LPToken.approve(lpmine.address, depositAmount);
    await lpmine.bond(depositAmount);

    await mockDAO.mock.getEpochStartTime.withArgs(51).returns(genesisTime + 51 * epochLength);

    let initialBalance = await dai.balanceOf(stabilizerNode.address);

    let callerBalance = await dai.balanceOf(userAddress);
    let lpMineBalance = await dai.balanceOf(lpmine.address);
    let daoBalance = await dai.balanceOf(mockDAO.address);
    let treasuryBalance = await dai.balanceOf(treasuryAddress);

    expect(callerBalance).to.equal(0);
    expect(lpMineBalance).to.equal(0);
    expect(daoBalance).to.equal(0);
    expect(treasuryBalance).to.equal(0);

    await stabilizerNode.connect(userAccount).stabilize();

    let finalBalance = await dai.balanceOf(stabilizerNode.address);

    const [finalReserveRatio, r] = await maltPoolPeriphery.reserveRatio();
    
    expect(finalBalance).to.be.above(initialBalance);
    expect(finalReserveRatio).to.be.above(utils.parseEther((minReserveRatio / 100).toString()));

    callerBalance = await dai.balanceOf(userAddress);
    lpMineBalance = await dai.balanceOf(lpmine.address);
    daoBalance = await dai.balanceOf(mockDAO.address);
    treasuryBalance = await dai.balanceOf(treasuryAddress);

    expect(callerBalance).to.be.above(0);
    expect(lpMineBalance).to.be.above(0);
    expect(daoBalance).to.be.gte(0);
    expect(treasuryBalance).to.be.above(0);
  });

  it("incentivized caller in expansion receives reward when liquidity is low", async function() {
    // When liquidity is low the 5% reward to the caller will not be enough to incentivize.
    // In that case some Malt is minted to them to improve incentive
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('1100');
    await addLiquidity(amountMalt, amountDai, 2);

    let initialCallerDaiBalance = await dai.balanceOf(userAddress);
    let initialCallerMaltBalance = await malt.balanceOf(userAddress);

    await stabilizerNode.connect(userAccount).stabilize();

    let finalCallerDaiBalance = await dai.balanceOf(userAddress);
    let finalCallerMaltBalance = await malt.balanceOf(userAddress);

    // User received less than $100 reward so they were minted 100 malt
    expect(finalCallerDaiBalance.sub(initialCallerDaiBalance)).to.be.below(utils.parseEther('100'));
    expect(finalCallerMaltBalance.sub(initialCallerMaltBalance)).to.equal(utils.parseEther('100'));
  });

  it("does not mint additional caller reward when dai reward is sufficient", async function() {
    // When liquidity is low the 5% reward to the caller will not be enough to incentivize.
    // In that case some Malt is minted to them to improve incentive
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('11000');
    await addLiquidity(amountMalt, amountDai, 2);

    let initialCallerDaiBalance = await dai.balanceOf(userAddress);
    let initialCallerMaltBalance = await malt.balanceOf(userAddress);

    await stabilizerNode.connect(userAccount).stabilize();

    let finalCallerDaiBalance = await dai.balanceOf(userAddress);
    let finalCallerMaltBalance = await malt.balanceOf(userAddress);

    expect(finalCallerDaiBalance.sub(initialCallerDaiBalance)).to.be.above(utils.parseEther('100'));
    expect(finalCallerMaltBalance.sub(initialCallerMaltBalance)).to.equal(0);
  });

  it("disallows immediately calling stabilize again", async function() {
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('1100');
    await addLiquidity(amountMalt, amountDai);

    await stabilizerNode.connect(userAccount).stabilize();
    await expect(stabilizerNode.stabilize()).to.be.reverted;
  });

  it("allows immediately calling stabilize if price is >20% above peg", async function() {
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    let amountMalt = utils.parseEther('800');
    let amountDai = utils.parseEther('1000');
    await addLiquidity(amountMalt, amountDai);

    await stabilizerNode.connect(userAccount).stabilize();

    // Buy to put price back above peg
    await buyMalt(utils.parseEther('300'), owner);

    await stabilizerNode.connect(userAccount).stabilize();
  });

  it("allows immediately calling stabilize if price is <10% above peg", async function() {
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    let amountMalt = utils.parseEther('900');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai);

    await stabilizerNode.connect(userAccount).stabilize();

    // Sell to put price back below peg
    await sellMalt(utils.parseEther('300'), owner);

    await stabilizerNode.connect(userAccount).stabilize();
  });

  it("can create two auctions in the same epoch", async function() {
    const ownerAddress = await owner.getAddress();
    const userAccount = accounts[0];
    const userAddress = await userAccount.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%

    const [initialReserveRatio, _] = await maltPoolPeriphery.reserveRatio();
    let auctionId = await auction.currentAuctionId();

    await stabilizerNode.connect(userAccount).stabilize();

    // This is the exact amount of dai required by this auction
    let amount = utils.parseEther('46.887580194532172099');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);

    // This should end current auction as it fully fills the pledge
    await stabilizerNode.purchaseArbitrageToken(amount);

    expect(await auction.auctionActive(auctionId)).to.equal(false);

    // Sell to put price back below peg
    await sellMalt(utils.parseEther('100'), owner);

    // Move forward in the epoch
    await increaseTime(epochLength / 3);
    await oracle.update(dai.address);

    await stabilizerNode.connect(userAccount).stabilize();

    let secondAuctionId = await auction.currentAuctionId();

    expect(await auction.auctionActive(secondAuctionId)).to.equal(true);

    expect(secondAuctionId).to.equal(auctionId.add(1));
  });

  it("Issues fixed reward when price is stable", async function() {
    const ownerAddress = await owner.getAddress();

    // Add equal liquidity
    let amountMalt = utils.parseEther('1000');
    let amountDai = utils.parseEther('1000');
    await addLiquidity(amountMalt, amountDai);

    await mockDAO.mock.getEpochStartTime.withArgs(51).returns(genesisTime + 51 * epochLength);
    
    // Bond the LP so there is something to distribute rewards to
    let balance = utils.parseEther('1000');
    let depositAmount = await LPToken.balanceOf(ownerAddress);
    await LPToken.approve(lpmine.address, depositAmount);
    await lpmine.bond(depositAmount);

    // initial stabilize call creates set point to measure
    await stabilizerNode.stabilize();

    const initialBalance = await malt.balanceOf(lpmine.address);

    // Increase time by one epoch
    await increaseTime(epochLength);

    await stabilizerNode.stabilize();
    await oracle.update(dai.address);

    const secondBalance = await malt.balanceOf(lpmine.address);

    const annualYield = await stabilizerNode.annualYield();

    const annualReturn = amountMalt.mul(annualYield).div(10000);

    expect(secondBalance.sub(initialBalance)).to.equal(annualReturn.mul(epochLength).div(31536000));

    // Increase time by half epoch
    await increaseTime(epochLength / 2);

    await stabilizerNode.stabilize();
    await oracle.update(dai.address);

    const thirdBalance = await malt.balanceOf(lpmine.address);

    expect(thirdBalance.sub(secondBalance)).to.be.gte(annualReturn.mul(epochLength / 2).div(31536000));
    expect(thirdBalance.sub(secondBalance)).to.be.lte(annualReturn.mul(epochLength / 2).div(31536000).mul(101).div(100));
  });

  it("Issues correct APY when price is stable", async function() {
    const ownerAddress = await owner.getAddress();

    // Add equal liquidity
    let amountMalt = utils.parseEther('1000');
    let amountDai = utils.parseEther('1000');
    await addLiquidity(amountMalt, amountDai);

    await mockDAO.mock.getEpochStartTime.withArgs(51).returns(genesisTime + 51 * epochLength);
    
    // Bond the LP so there is something to distribute rewards to
    let balance = utils.parseEther('1000');
    let depositAmount = await LPToken.balanceOf(ownerAddress);
    await LPToken.approve(lpmine.address, depositAmount);
    await lpmine.bond(depositAmount);

    // initial stabilize call creates set point to measure
    await stabilizerNode.stabilize();

    const initialBalance = await malt.balanceOf(lpmine.address);

    // Increase time to next year
    await increaseTime((60 * 60 * 24 * 365) - epochLength * 48);

    // Manually do final 48 epochs so oracle is up to date
    for (let i = 0; i < 48; i++) {
      await oracle.update(dai.address);
      await increaseTime(epochLength);
    }
    await stabilizerNode.stabilize();

    const secondBalance = await malt.balanceOf(lpmine.address);

    const annualYield = await stabilizerNode.annualYield();

    const annualReturn = amountMalt.mul(annualYield).div(10000);

    expect(secondBalance.sub(initialBalance)).to.be.gte(annualReturn);
    expect(secondBalance.sub(initialBalance)).to.be.lte(annualReturn.mul(101).div(100));
  });

  it("Correctly returns all auctions a user has participated in", async function() {
    const ownerAddress = await owner.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    // Create first auction
    await stabilizerNode.stabilize();

    // Purchase arb tokens
    let amount = utils.parseEther('1');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);
    await stabilizerNode.purchaseArbitrageToken(amount);

    // Create second auction
    await sellMalt(utils.parseEther('100'), owner);
    currentEpoch = await advanceOracle(1);
    await stabilizerNode.stabilize();

    // Create third auction
    currentEpoch = await advanceOracle(1);
    await sellMalt(utils.parseEther('100'), owner);
    await stabilizerNode.stabilize();

    // Purchase arb tokens in third auction
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);
    await stabilizerNode.purchaseArbitrageToken(amount);

    const auctions = await auction.getAccountCommitmentAuctions(ownerAddress);
  
    // Took part in the first and third auctions
    expect(auctions[0]).to.equal(0);
    expect(auctions[1]).to.equal(2);
  });

  it("Can fetch the active auction", async function() {
    const ownerAddress = await owner.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let initialAuctionId = await auction.currentAuctionId();

    await stabilizerNode.stabilize();

    const {
      auctionId,
      maxCommitments,
      commitments,
      maltPurchased,
      startingPrice,
      endingPrice,
      finalPrice,
      pegPrice,
      startingTime,
      initialReservePledge
    } = await auction.getActiveAuction();

    expect(auctionId).to.equal(initialAuctionId);
    expect(maxCommitments).to.be.above(utils.parseEther('40'));
    expect(commitments).to.equal(0);
    expect(maltPurchased).to.be.above(utils.parseEther('25'));
    expect(startingPrice).to.be.lte(utils.parseEther('1'));
    expect(startingPrice).to.be.above(utils.parseEther('0.98'));
    expect(endingPrice).to.equal(utils.parseEther('0.5'));
    expect(finalPrice).to.equal(0);
    expect(pegPrice).to.equal(utils.parseEther('1'));
    expect(startingTime).to.be.above(0);
    expect(initialReservePledge).to.be.above(utils.parseEther('20'));
  });

  it("fetches all users auction commitments", async function() {
    const ownerAddress = await owner.getAddress();

    // Add liquidity such that malt is priced lower
    let amountMalt = utils.parseEther('1100');
    let amountDai = utils.parseEther('900');
    await addLiquidity(amountMalt, amountDai, 2); // 2 is initial reserveFactor ie 50%
    let auctionId = await auction.currentAuctionId();

    // Create first auction
    await stabilizerNode.stabilize();

    // Purchase arb tokens
    let amount = utils.parseEther('1');
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);
    await stabilizerNode.purchaseArbitrageToken(amount);

    // Create second auction
    await sellMalt(utils.parseEther('100'), owner);
    currentEpoch = await advanceOracle(1);
    await stabilizerNode.stabilize();

    // Create third auction
    currentEpoch = await advanceOracle(1);
    await sellMalt(utils.parseEther('100'), owner);
    await stabilizerNode.stabilize();

    // Purchase arb tokens in third auction
    await dai.mint(ownerAddress, amount);
    await dai.approve(stabilizerNode.address, amount);
    await stabilizerNode.purchaseArbitrageToken(amount);

    let [
      auctions,
      commitments,
      awardedTokens,
      redeemedTokens,
      finalPrice
    ] = await auction.getAccountCommitments(ownerAddress);

    expect(commitments[0]).to.equal(amount);
    // Final price was 0.5 so 2 tokens per dai awarded
    expect(awardedTokens[0]).to.equal(amount.mul(2));
    expect(redeemedTokens[0]).to.equal(0);
    expect(finalPrice[0]).to.equal(utils.parseEther('0.5'));

    expect(commitments[1]).to.equal(amount);
    expect(awardedTokens[1]).to.be.above(amount);
    expect(redeemedTokens[1]).to.equal(0);
    expect(finalPrice[1]).to.be.above(utils.parseEther('0.5'));

    currentEpoch = await advanceOracle(1);
    await buyMalt(utils.parseEther('1000'), owner);
    currentEpoch = await advanceOracle(1);
    await stabilizerNode.stabilize();

    await stabilizerNode.claimArbitrage(auctionId);

    [
      auctions,
      commitments,
      awardedTokens,
      redeemedTokens,
      finalPrice
    ] = await auction.getAccountCommitments(ownerAddress);

    expect(commitments[0]).to.equal(amount);
    // Final price was 0.5 so 2 tokens per dai awarded
    expect(awardedTokens[0]).to.equal(amount.mul(2));
    expect(redeemedTokens[0]).to.equal(utils.parseEther('2'));
    expect(finalPrice[0]).to.equal(utils.parseEther('0.5'));
  });

  it("dao only methods", async function() {
    // should there be other dao only methods?
    // How to call them?
    // Maybe separate describe with it's own setup that doesn't use mockDAO and uses owner instead
  });
});
