import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { Oracle } from "../type/Oracle";
import { LiquidityMine } from "../type/LiquidityMine";
import { Malt } from "../type/Malt";
import { Stabilizer } from "../type/Stabilizer";
import { StabilizerNode } from "../type/StabilizerNode";
import { MaltPoolPeriphery } from "../type/MaltPoolPeriphery";
import { AuctionBurnReserveSkew } from "../type/AuctionBurnReserveSkew";
import { ERC20 } from "../type/ERC20";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
// @ts-ignore
import { time } from "@openzeppelin/test-helpers";
import UniswapV2FactoryBuild from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2RouterBuild from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import WETHBuild from "@uniswap/v2-periphery/build/WETH9.json";
import { increaseTime, hardhatSnapshot, hardhatRevert, lpPoolAdvancerFactory } from "./helpers";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import IDAOArtifacts from "../artifacts/contracts/interfaces/IDAO.sol/IDAO.json";
import { IDAO } from "../type/IDAO";
import { IAuction } from "../type/IAuction";
import { ILiquidityMineReinvest } from "../type/ILiquidityMineReinvest";

const { deployMockContract } = waffle;

const UniswapV2FactoryBytecode = UniswapV2FactoryBuild.bytecode;
const UniswapV2FactoryAbi = UniswapV2FactoryBuild.abi;
const UniswapV2RouterBytecode = UniswapV2RouterBuild.bytecode;
const UniswapV2RouterAbi = UniswapV2RouterBuild.abi;
const WETHBytecode = WETHBuild.bytecode;
const WETHAbi = WETHBuild.abi;

describe("Liquidity Provider Staking Pool", function() {
  let accounts: Signer[];
  let owner: Signer;
  let timelock: Signer;
  let oracle: Signer;
  let treasury: Signer;
  let mockDAO: IDAO;
  let auction: IAuction;
  let lpmine: LiquidityMine;
  let lpmineReinvestor: ILiquidityMineReinvest;
  let burnReserveSkew: AuctionBurnReserveSkew;
  let maltPoolPeriphery: MaltPoolPeriphery;
  let malt: ERC20;
  let dai: ERC20;
  let LPToken: ERC20;
  let payoutEpochs = 48;
  let stakePaddingMultiple = 1e6;
  let epochLength = 60 * 30; // 30 minutes
  let snapshotId: string;
  let advanceLpPool: any;
  let factory: any;
  let router: any;
  let weth: Contract;
  let stabilizer: Stabilizer;
  let stabilizerNode: StabilizerNode;

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, treasury, timelock, oracle, ...accounts] = await ethers.getSigners();
    const ownerAddress = await owner.getAddress();
    const timelockAddress = await timelock.getAddress();
    const oracleAddress = await oracle.getAddress();
    const MaltFactory = await ethers.getContractFactory("Malt");

    const factoryContract = new ContractFactory(UniswapV2FactoryAbi, UniswapV2FactoryBytecode, owner);
    factory = await factoryContract.deploy(constants.AddressZero);

    malt = (await MaltFactory.deploy("Malt Stablecoin", "MALT")) as Malt;
    dai = (await MaltFactory.deploy("Dai Stablecoin", "DAI")) as Malt;

    let tx = await factory.createPair(malt.address, dai.address);
    await tx.wait();

    let pair = await factory.getPair(malt.address, dai.address);

    LPToken = (new Contract(pair, IERC20.abi, owner)) as Malt;

    mockDAO = ((await deployMockContract(owner, IDAOArtifacts.abi)) as any) as IDAO;

    const routerContract = new ContractFactory(UniswapV2RouterAbi, UniswapV2RouterBytecode, owner);
    const wethContract = new ContractFactory(WETHAbi, WETHBytecode, owner);
  
    weth = await wethContract.deploy();
    await weth.deployed();
    router = await routerContract.deploy(factory.address, weth.address);
    await router.deployed();

    const genesisTime = Math.floor(new Date().getTime() / 1000);
    await mockDAO.mock.epochLength.returns(epochLength);
    await mockDAO.mock.genesisTime.returns(genesisTime);
    await mockDAO.mock.epoch.returns(0);

    for (let i = 0; i < 150; i++) {
      await mockDAO.mock.getEpochStartTime.withArgs(i).returns(genesisTime + i * epochLength);
    }

    const LPFactory = await ethers.getContractFactory("LiquidityMine");

    const treasuryAddress = await treasury.getAddress();

    const StabilizerNodeFactory = await ethers.getContractFactory("StabilizerNode");
    stabilizerNode = (await StabilizerNodeFactory.deploy()) as StabilizerNode;

    const StabilizerFactory = await ethers.getContractFactory("Stabilizer");
    const AuctionFactory = await ethers.getContractFactory("AuctionBase");
    const BurnReserveSkewFactory = await ethers.getContractFactory("AuctionBurnReserveSkew");
    const LiquidityMineReinvestFactory = await ethers.getContractFactory("LiquidityMineReinvest");

    auction = (await AuctionFactory.deploy()) as IAuction;

    lpmineReinvestor = (await LiquidityMineReinvestFactory.deploy()) as ILiquidityMineReinvest;

    stabilizer = (await StabilizerFactory.deploy()) as Stabilizer;
    await stabilizer.initialize(ownerAddress, malt.address, timelockAddress, stabilizerNode.address, dai.address);

    burnReserveSkew = (await BurnReserveSkewFactory.deploy()) as AuctionBurnReserveSkew;
    await burnReserveSkew.initialize(
      stabilizerNode.address,
      timelockAddress,
      10
    );

    await stabilizerNode.deployed();

    lpmine = (await LPFactory.deploy()) as LiquidityMine;
    await lpmine.initialize(
      dai.address,
      malt.address,
      LPToken.address,
      payoutEpochs,
      genesisTime,
      mockDAO.address,
      treasuryAddress,
      router.address,
      stabilizerNode.address,
      timelockAddress,
      lpmineReinvestor.address,
      constants.AddressZero
    );
    await lpmine.deployed();

    const MaltPoolPeripheryFactory = await ethers.getContractFactory("MaltPoolPeriphery");

    maltPoolPeriphery = (await MaltPoolPeripheryFactory.deploy()) as MaltPoolPeriphery;
    maltPoolPeriphery.initialize(
      stabilizerNode.address,
      mockDAO.address,
      factory.address,
      malt.address,
      dai.address,
      utils.parseEther('1'), // $1
    );
    await lpmine.connect(timelock).setNewPoolPeriphery(maltPoolPeriphery.address);

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

    await stabilizerNode.initialize(
      mockDAO.address,
      timelockAddress,
      stabilizer.address,
      lpmine.address,
      oracleAddress,
      router.address,
      factory.address,
      malt.address,
      dai.address,
      treasuryAddress,
      auction.address,
    );
    await stabilizerNode.connect(timelock).setAuctionBurnSkew(burnReserveSkew.address);
    await stabilizerNode.connect(timelock).setNewPoolPeriphery(maltPoolPeriphery.address);

    await auction.initialize(
      stabilizerNode.address,
      maltPoolPeriphery.address,
      dai.address,
      malt.address,
      60 * 30, // 30 mins auction length
      ownerAddress
    );
    await auction.deployed();

    await malt.initialize(ownerAddress, stabilizer.address, timelockAddress);
    await malt.deployed();
    await dai.initialize(ownerAddress, stabilizer.address, timelockAddress);
    await dai.deployed();
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    const ownerAddress = await owner.getAddress();

    expect(await lpmine.totalBonded()).to.equal(0);
    expect(await lpmine.totalBondedRewarded()).to.equal(0);
    expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(0);
    expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
    const [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
    expect(daiEarned).to.equal(0);
    expect(maltEarned).to.equal(0);
  });

  it("Fails to bond zero LP tokens", async function() {
    const ownerAddress = await owner.getAddress();

    await expect(lpmine.bond(0)).to.be.reverted;
  });

  it("Fails to bond with no staged tokens", async function() {
    let currentEpoch = 5;
    const ownerAddress = await owner.getAddress();

    await mockDAO.mock.epoch.returns(currentEpoch);

    await expect(lpmine.bond(100)).to.be.reverted;
  });

  it("Can bond deposited tokens", async function() {
    const ownerAddress = await owner.getAddress();
    let balance = utils.parseEther('1000');

    await malt.mint(ownerAddress, balance);
    await dai.mint(ownerAddress, balance);

    await malt.approve(router.address, balance);
    await dai.approve(router.address, balance);

    const data = await router.addLiquidity(
      malt.address,
      dai.address,
      balance,
      balance,
      balance,
      balance,
      ownerAddress,
      new Date().getTime() + 10000,
    );

    let depositAmount = await LPToken.balanceOf(ownerAddress);
    await LPToken.approve(lpmine.address, depositAmount);

    await lpmine.bond(depositAmount);

    expect(await lpmine.totalBonded()).to.equal(depositAmount);
    expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(depositAmount);
    expect(await lpmine.totalBondedRewarded()).to.equal(0);
    expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);

    const [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
    expect(daiEarned).to.equal(0);
    expect(maltEarned).to.equal(0);
  });

  it("forfeits the entire reward when there are no bonders", async function() {
    let rewardAmount = utils.parseEther('1');

    await mockDAO.mock.epoch.returns(1);
    await dai.mint(lpmine.address, rewardAmount);

    await lpmine.connect(timelock).declareReward(rewardAmount);

    expect(await lpmine.totalBonded()).to.equal(0);
  });

  describe("With bonded balance", function() {
    let depositAmount: BigNumber;
    let currentEpoch: number = 0;

    beforeEach(async function() {
      advanceLpPool = lpPoolAdvancerFactory(lpmine, epochLength, mockDAO);
      currentEpoch = await advanceLpPool(1);

      const ownerAddress = await owner.getAddress();

      // 1000usd on each side of pair in pool
      let balance = utils.parseEther('1000');

      await malt.mint(ownerAddress, balance);
      await dai.mint(ownerAddress, balance);

      await malt.approve(router.address, balance);
      await dai.approve(router.address, balance);

      const data = await router.addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        ownerAddress,
        new Date().getTime() + 10000,
      );

      depositAmount = await LPToken.balanceOf(ownerAddress);
      await LPToken.approve(lpmine.address, depositAmount);

      await lpmine.bond(depositAmount);

      currentEpoch = await advanceLpPool(1);

      await mockDAO.mock.getLockedMalt.returns(0);
    });

    it("Can unbond", async function() {
      const ownerAddress = await owner.getAddress();

      await lpmine.unbond(depositAmount);

      expect(await lpmine.totalBonded()).to.equal(0);
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(0);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.equal(0);
      expect(maltEarned).to.equal(0);
    });

    it("Cannot unbond more than available", async function() {
      await expect(lpmine.unbond(depositAmount.add(1))).to.be.reverted;
    });

    it("Cannot withdraw more than available", async function() {
      await expect(lpmine.withdraw(utils.parseEther('10000'), utils.parseEther('100000'))).to.be.reverted;
      await expect(lpmine.withdraw(0, utils.parseEther('100000'))).to.be.reverted;
      await expect(lpmine.withdraw(utils.parseEther('10000'), 0)).to.be.reverted;
    });

    it("Can unbond when only partially locked in dao", async function() {
      const ownerAddress = await owner.getAddress();
      await mockDAO.mock.getLockedMalt.returns(depositAmount.div(2));

      await lpmine.unbond(depositAmount.div(2));

      expect(await lpmine.totalBonded()).to.equal(depositAmount.div(2));
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(depositAmount.div(2));
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);

      const [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.equal(0);
      expect(maltEarned).to.equal(0);
    });

    it("DAO can declare rewards", async function() {
      let rewardAmount = utils.parseEther('1');

      await mockDAO.mock.epoch.returns(currentEpoch);
      await dai.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);

      expect(await lpmine.totalBondedRewarded()).to.equal(rewardAmount);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
    });

    it("DAO can declare malt rewards", async function() {
      let rewardAmount = utils.parseEther('1');

      await mockDAO.mock.epoch.returns(currentEpoch);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(rewardAmount);
    });

    it("Non DAO can not declare rewards", async function() {
      const otherAccount = accounts[0];
      let rewardAmount = utils.parseEther('1');
      await expect(lpmine.connect(otherAccount).declareReward(rewardAmount)).to.be.reverted;

      expect(await lpmine.totalBondedRewarded()).to.equal(0);
    });

    it("Non DAO can not declare malt rewards", async function() {
      const otherAccount = accounts[0];
      let rewardAmount = utils.parseEther('1');
      await expect(lpmine.connect(otherAccount).declareMaltReward(rewardAmount)).to.be.reverted;

      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
    });

    it("Can only declare reward when there is sufficient balance", async function() {
      let rewardAmount = utils.parseEther('1');

      await expect(lpmine.connect(timelock).declareReward(rewardAmount)).to.be.reverted;
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
    });

    it("Can only declare malt reward when there is sufficient balance", async function() {
      let rewardAmount = utils.parseEther('1');

      await expect(lpmine.connect(timelock).declareMaltReward(rewardAmount)).to.be.reverted;
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
    });

    it("Cannot declare zero reward", async function() {
      let rewardAmount = utils.parseEther('1');

      await mockDAO.mock.epoch.returns(currentEpoch);

      await expect(lpmine.connect(timelock).declareReward(0)).to.be.reverted;
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
    });

    it("Cannot declare zero malt reward", async function() {
      let rewardAmount = utils.parseEther('1');

      await mockDAO.mock.epoch.returns(currentEpoch);

      await expect(lpmine.connect(timelock).declareMaltReward(0)).to.be.reverted;
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
    });

    it("allocates the full reward initially but earned starts at zero", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');

      await mockDAO.mock.epoch.returns(currentEpoch);
      await dai.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(10).div(100)); // Less than 10% of 1 epoch
      expect(maltEarned).to.equal(0);
      expect(await lpmine.totalBondedRewarded()).to.equal(rewardAmount);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);

      currentEpoch = await advanceLpPool(1);

      expect(await lpmine.totalBondedRewarded()).to.equal(rewardAmount);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);

      [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      // Initial earned reward is less than one epoch of rewards
      expect(daiEarned).to.be.above(0);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(115).div(100)); // Allow 15% tolerance
      expect(maltEarned).to.equal(0)
    });

    it("allocates the full malt reward initially but earned starts at zero", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');

      await mockDAO.mock.epoch.returns(currentEpoch);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.equal(0);
      expect(maltEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(10).div(100)); // less than 10% into the epoch
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);

      currentEpoch = await advanceLpPool(1);

      expect(await lpmine.totalBondedMaltRewarded()).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);

      [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      // Initial earned reward is less than one epoch of rewards
      expect(maltEarned).to.be.above(0);
      expect(maltEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(115).div(100)); // up to 15% into new epoch
      expect(daiEarned).to.equal(0)
    });

    it("Full reward is released after payout period", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');

      await dai.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(10).div(100)); // 10% into epoch
      expect(maltEarned).to.equal(0);

      currentEpoch = await advanceLpPool(payoutEpochs);

      [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.equal(rewardAmount);
      expect(maltEarned).to.equal(0);
    });

    it("Full malt reward is released after payout period", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');

      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.equal(0);
      expect(maltEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(10).div(100)); // 10% into the epoch

      currentEpoch = await advanceLpPool(payoutEpochs);

      [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.equal(0);
      expect(maltEarned).to.equal(rewardAmount);
    });

    it("Half reward is released after half the payout period", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');

      await dai.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(10).div(100)); // 10% into epoch
      expect(maltEarned).to.equal(0);

      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);

      expect(daiEarned).to.be.above(rewardAmount.div(2));
      expect(daiEarned).to.be.below(rewardAmount.div(2).mul(101).div(100));
      expect(maltEarned).to.equal(0);
    });

    it("Half malt reward is released after half the payout period", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');

      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.equal(0);
      expect(maltEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(10).div(100));

      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);

      expect(maltEarned).to.be.above(rewardAmount.div(2));
      expect(maltEarned).to.be.below(rewardAmount.div(2).mul(101).div(100));
      expect(daiEarned).to.equal(0);
    });

    it("Rewards spread evenly between users", async function() {
      // Add another LPer
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();
      const ownerAddress = await owner.getAddress();

      // 1000usd on each side of pair in pool
      let balance = utils.parseEther('1000');

      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      // Have to move forward an epoch so the second user is elligible for rewards
      currentEpoch = await advanceLpPool(1);

      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.2');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // reward split evenly between two accounts
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount.div(2).sub(1));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount.div(2).sub(1));

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(6).div(100));
      expect(maltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(6).div(100));

      [daiEarned, maltEarned] = await lpmine.earned(otherAddress);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(6).div(100));
      expect(maltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(6).div(100));

      expect(await lpmine.balanceOfRewards(otherAddress)).to.equal(rewardAmount.div(2));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.equal(maltAmount.div(2));


      // Advance half the reward period each user should get half their rewards ie 1/4 reward pool
      currentEpoch = await advanceLpPool(payoutEpochs / 2);


      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.above(rewardAmount.div(4).sub(1));
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(4).sub(1).mul(102).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.div(4).sub(1));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(4).sub(1).mul(102).div(100));

      let [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(otherDaiEarned).to.be.above(rewardAmount.div(4));
      expect(otherDaiEarned).to.be.below(rewardAmount.div(4).mul(102).div(100));
      expect(otherMaltEarned).to.be.above(maltAmount.div(4));
      expect(otherMaltEarned).to.be.below(maltAmount.div(4).mul(102).div(100));

      // Advance past the reward period. Each user now gets half the reward pool each
      currentEpoch = await advanceLpPool(payoutEpochs);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(rewardAmount.div(2).sub(1));
      expect(ownerMaltEarned).to.equal(maltAmount.div(2).sub(1));

      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(otherDaiEarned).to.equal(rewardAmount.div(2));
      expect(otherMaltEarned).to.equal(maltAmount.div(2));
    });

    it("Late user gets no rewards from previous payouts", async function() {
      // Declare rewards first
      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // Add another LPer
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();
      const ownerAddress = await owner.getAddress();

      // 1000usd on each side of pair in pool
      let balance = utils.parseEther('1000');

      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount.sub(1));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount.sub(1));

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(15).div(100));
      expect(maltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(15).div(100));

      expect(await lpmine.balanceOfRewards(otherAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.equal(0);

      let [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(otherDaiEarned).to.equal(0);
      expect(otherMaltEarned).to.equal(0);

      currentEpoch = await advanceLpPool(payoutEpochs / 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.above(rewardAmount.div(2));
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(2).mul(101).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.div(2));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(2).mul(101).div(100));

      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(otherDaiEarned).to.equal(0);
      expect(otherMaltEarned).to.equal(0);

      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(rewardAmount);
      expect(ownerMaltEarned).to.equal(maltAmount);

      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(otherDaiEarned).to.equal(0);
      expect(otherMaltEarned).to.equal(0);
    });

    it("Late user gets payout from subsequent reward", async function() {
      // Declare rewards first
      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // Add another LPer
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();
      const ownerAddress = await owner.getAddress();

      // 1000usd on each side of pair in pool
      let balance = utils.parseEther('1000');

      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount.sub(1));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount.sub(1));

      let [daiEarned, maltEarned] = await lpmine.earned(ownerAddress);
      expect(daiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(15).div(100));
      expect(maltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(15).div(100));

      expect(await lpmine.balanceOfRewards(otherAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.equal(0);

      let [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(otherDaiEarned).to.equal(0);
      expect(otherMaltEarned).to.equal(0);

      // Move to half way through the first reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2)

      // Add another reward
      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);
      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // owner gets all of first reward and 1/2 of second ie 3/4 of all rewards which is 1.5
      // the original reward
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount.mul(3).div(2).sub(1));
      expect(await lpmine.balanceOfRewards(otherAddress)).to.equal(rewardAmount.div(2));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount.mul(3).div(2).sub(1));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.equal(maltAmount.div(2));

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);

      // Half way through first reward and zero of second
      // Using a range here because of numerical error resulting in the earnings
      // not being 100% accurate to the % of elapsed time
      expect(ownerDaiEarned).to.be.above(rewardAmount.mul(50).div(100));
      expect(ownerDaiEarned).to.be.below(rewardAmount.mul(51).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.mul(50).div(100));
      expect(ownerMaltEarned).to.be.below(maltAmount.mul(51).div(100));
      expect(otherDaiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(7).div(100));
      expect(otherMaltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(7).div(100));

      // Forward to end of first reward
      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(ownerDaiEarned).to.be.above(rewardAmount.mul(125).div(100));
      expect(ownerDaiEarned).to.be.below(rewardAmount.mul(126).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.mul(125).div(100));
      expect(ownerMaltEarned).to.be.below(maltAmount.mul(126).div(100));

      expect(otherDaiEarned).to.be.above(rewardAmount.mul(25).div(100));
      expect(otherDaiEarned).to.be.below(rewardAmount.mul(26).div(100));
      expect(otherMaltEarned).to.be.above(maltAmount.mul(25).div(100));
      expect(otherMaltEarned).to.be.below(maltAmount.mul(26).div(100));

      // Move to end of second reward
      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);

      expect(ownerDaiEarned).to.equal(rewardAmount.mul(150).div(100).sub(1));
      expect(otherDaiEarned).to.equal(rewardAmount.mul(50).div(100));
      expect(ownerMaltEarned).to.equal(maltAmount.mul(150).div(100).sub(1));
      expect(otherMaltEarned).to.equal(maltAmount.mul(50).div(100));
    });

    it("Unbonding leaves rewards untouched", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount);

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(11).div(100));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(11).div(100));

      currentEpoch = await advanceLpPool(payoutEpochs);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(rewardAmount);
      expect(ownerMaltEarned).to.equal(maltAmount);

      await lpmine.unbond(depositAmount);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(rewardAmount);
      expect(ownerMaltEarned).to.equal(maltAmount);

      expect(await lpmine.totalBonded()).to.equal(0);
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(0);
      // These are 0 as the unclaimed rewards get moved to unbondedRewards after user unbonds
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      // The balanceOf methods show how much reward is allocated to the bonded value
      // Because the account unbonded the value allocated is 0
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
    });

    it("User can partially unbond and continue receiving rewards", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount);

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(11).div(100));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(11).div(100));

      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.above(rewardAmount.div(2));
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(2).mul(101).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.div(2));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(2).mul(101).div(100));

      await lpmine.unbond(depositAmount.div(2));

      // Earned amount should not have changed after unbonding
      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.above(rewardAmount.div(2));
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(2).mul(101).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.div(2));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(2).mul(101).div(100));

      expect(await lpmine.totalBonded()).to.equal(depositAmount.div(2));
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(depositAmount.div(2));
      // 1/4 of the rewards have been forfeited and 1/4 moved to unbonded rewards
      expect(await lpmine.totalBondedRewarded()).to.equal(rewardAmount.mul(1).div(2));
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(maltAmount.mul(1).div(2));
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount.div(2));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount.div(2));
      // Move to end of reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.above(rewardAmount.mul(3).div(4));
      expect(ownerDaiEarned).to.be.below(rewardAmount.mul(3).div(4).mul(101).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.mul(3).div(4));
      expect(ownerMaltEarned).to.be.below(maltAmount.mul(3).div(4).mul(101).div(100));

      expect(await lpmine.totalBonded()).to.equal(depositAmount.div(2));
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(depositAmount.div(2));
      // 1/4 of the rewards have been forfeited and 1/4 moved to unbonded
      expect(await lpmine.totalBondedRewarded()).to.equal(rewardAmount.mul(1).div(2));
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(maltAmount.mul(1).div(2));
      // balanceOf* only shows rewards on currently bonded. So the 1/4 of total reward already
      // earned from the previous withdraw isn't part of it
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount.div(2));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount.div(2));

      await lpmine.unbond(depositAmount.div(2));

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.above(rewardAmount.mul(3).div(4));
      expect(ownerDaiEarned).to.be.below(rewardAmount.mul(3).div(4).mul(101).div(100));
      expect(ownerMaltEarned).to.be.above(maltAmount.mul(3).div(4));
      expect(ownerMaltEarned).to.be.below(maltAmount.mul(3).div(4).mul(101).div(100));

      expect(await lpmine.totalBonded()).to.equal(0);
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(0);

      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);

      // balanceOf* returns the balance allocated to the account's bonded value
      // Because the account unbonded this value is 0
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
    });

    it("User can unbond full rewards", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount);

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(11).div(100));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(11).div(100));

      currentEpoch = await advanceLpPool(payoutEpochs);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(rewardAmount);
      expect(ownerMaltEarned).to.equal(maltAmount);

      await lpmine.unbond(depositAmount);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(rewardAmount);
      expect(ownerMaltEarned).to.equal(maltAmount);

      expect(await lpmine.totalBonded()).to.equal(0);
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(0);

      // rewards have all been moved to unbonded
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
    });

    it("User can withdraw full rewards", async function() {
      const ownerAddress = await owner.getAddress();
      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount);

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(11).div(100));
      expect(ownerMaltEarned).to.be.below(maltAmount.div(payoutEpochs).mul(11).div(100));

      currentEpoch = await advanceLpPool(payoutEpochs);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(rewardAmount);
      expect(ownerMaltEarned).to.equal(maltAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(maltAmount);

      await lpmine.withdraw(ownerDaiEarned, ownerMaltEarned);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(0);

      expect(await lpmine.totalBonded()).to.equal(depositAmount);
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(depositAmount);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
    });

    it("Multiple users can unbond rewards", async function() {
      // Declare rewards first
      let rewardAmount = utils.parseEther('100');
      let maltAmount = utils.parseEther('10');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // Add another LPer
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();
      const ownerAddress = await owner.getAddress();

      // 1000usd on each side of pair in pool
      let balance = utils.parseEther('1000');

      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      // Move to half way through the first reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2)

      // Add another reward
      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);
      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // Forward to end of all rewards
      currentEpoch = await advanceLpPool(payoutEpochs)

      // Unbonding
      await lpmine.unbond(depositAmount);
      await lpmine.connect(otherAccount).unbond(otherDepositAmount);

      expect(await lpmine.totalBonded()).to.equal(0);
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfBonded(otherAddress)).to.equal(0);
      // rewards have been moved to unbonded
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.equal(0);

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      let [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);

      // .sub(100) due to numerical error
      expect(ownerDaiEarned).to.be.above(rewardAmount.mul(3).div(2).sub(100));
      expect(ownerDaiEarned).to.be.below(rewardAmount.mul(3).div(2));
      expect(ownerMaltEarned).to.be.above(maltAmount.mul(3).div(2).sub(10));
      expect(ownerMaltEarned).to.be.below(maltAmount.mul(3).div(2));

      expect(otherDaiEarned).to.be.above(rewardAmount.div(2));
      expect(otherDaiEarned).to.be.below(rewardAmount.div(2).add(100));
      expect(otherMaltEarned).to.be.above(maltAmount.div(2));
      expect(otherMaltEarned).to.be.below(maltAmount.div(2).add(10));
    });

    it("Multiple users can withdraw rewards", async function() {
      // Declare rewards first
      let rewardAmount = utils.parseEther('1');
      let maltAmount = utils.parseEther('0.1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // Add another LPer
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();
      const ownerAddress = await owner.getAddress();

      // 1000usd on each side of pair in pool
      let balance = utils.parseEther('1000');

      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      // Move to half way through the first reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2)

      // Add another reward
      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltAmount);
      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltAmount);

      // Forward to end of all rewards
      currentEpoch = await advanceLpPool(payoutEpochs)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const totalRewards = rewardAmount.mul(2);
      const totalMaltRewards = maltAmount.mul(2);

      // rewardAmount.div(payoutEpochs).mul(11).div(100)

      expect(ownerDaiEarned).to.equal(totalRewards.mul(3).div(4).sub(1));
      expect(ownerMaltEarned).to.equal(totalMaltRewards.mul(3).div(4).sub(1));

      // Owner withdrawing
      await lpmine.withdraw(ownerDaiEarned, ownerMaltEarned);

      let [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);

      // Other user gets a quarter of total rewards
      expect(otherDaiEarned).to.equal(totalRewards.div(4));
      expect(otherMaltEarned).to.equal(totalMaltRewards.div(4));

      // Other withdrawing
      await lpmine.connect(otherAccount).withdraw(otherDaiEarned, otherMaltEarned);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);

      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(0);

      expect(otherDaiEarned).to.equal(0);
      expect(otherMaltEarned).to.equal(0);

      expect(await lpmine.totalBonded()).to.equal(depositAmount.add(otherDepositAmount));
      expect(await lpmine.balanceOfBonded(ownerAddress)).to.equal(depositAmount);
      expect(await lpmine.balanceOfBonded(otherAddress)).to.equal(otherDepositAmount);

      // There might be some dust due to rounding error. In wei
      expect(await lpmine.totalBondedRewarded()).to.be.below(10);
      expect(await lpmine.totalBondedMaltRewarded()).to.be.below(10);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfRewards(otherAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.equal(0);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);

      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(0);

      expect(otherDaiEarned).to.equal(0);
      expect(otherMaltEarned).to.equal(0);
    });

    it("Early unbond transfers forfeited rewards to DAO", async function() {
      // Declare rewards first
      let rewardAmount = utils.parseEther('1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount.div(2));

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount.div(2));

      // Move to half way through the reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2)

      // Unbonding
      await lpmine.unbond(depositAmount);

      // The user forfeits 1/2 of the reward to the treasury.
      // The other half has been earned and will remain claimable
      // Reward balance has been moved to unbonded and is therefore 0
      expect(await lpmine.totalBonded()).to.equal(0);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);

      // TODO assert earned balance Wed 31 Mar 2021 14:58:18 BST

      // TODO assert treasury receives the balance Wed 31 Mar 2021 14:52:55 BST
    });

    it("Early withdraw does not forfeit any rewards", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('1');

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(0);

      const maltReward = rewardAmount.div(2);

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltReward);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltReward);

      // Move to half way through the first reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.be.gte(utils.parseEther('0.49'));
      expect(ownerDaiEarned).to.be.lte(utils.parseEther('0.51'));
      expect(ownerMaltEarned).to.be.gte(utils.parseEther('0.24'));
      expect(ownerMaltEarned).to.be.lte(utils.parseEther('0.26'));

      await lpmine.withdraw(ownerDaiEarned, ownerMaltEarned);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.be.below(rewardAmount.div(payoutEpochs).mul(10).div(100));
      expect(ownerMaltEarned).to.be.below(maltReward.div(payoutEpochs).mul(10).div(100));

      expect(await lpmine.totalBonded()).to.equal(depositAmount);
      expect(await lpmine.totalBondedRewarded()).to.gte(utils.parseEther('0.49'));
      expect(await lpmine.totalBondedRewarded()).to.lte(utils.parseEther('0.51'));
      expect(await lpmine.totalBondedMaltRewarded()).to.gte(utils.parseEther('0.24'));
      expect(await lpmine.totalBondedMaltRewarded()).to.lte(utils.parseEther('0.26'));
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.gte(utils.parseEther('0.49'));
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.lte(utils.parseEther('0.51'));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.gte(utils.parseEther('0.24'));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.lte(utils.parseEther('0.26'));
      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      // The other half
      expect(ownerDaiEarned).to.gte(utils.parseEther('0.49'));
      expect(ownerDaiEarned).to.lte(utils.parseEther('0.51'));
      expect(ownerMaltEarned).to.gte(utils.parseEther('0.24'));
      expect(ownerMaltEarned).to.lte(utils.parseEther('0.26'));

      await lpmine.withdraw(ownerDaiEarned, ownerMaltEarned);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(0);

      expect(await lpmine.totalBonded()).to.equal(depositAmount);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
    });

    it("Handles a partial withdraw", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('1');

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(0);

      const maltReward = rewardAmount.div(2);

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, maltReward);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(maltReward);

      // Move to half way through the first reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.be.gte(utils.parseEther('0.49'));
      expect(ownerDaiEarned).to.be.lte(utils.parseEther('0.51'));
      expect(ownerMaltEarned).to.be.gte(utils.parseEther('0.24'));
      expect(ownerMaltEarned).to.be.lte(utils.parseEther('0.26'));

      await lpmine.withdraw(ownerDaiEarned.div(2), ownerMaltEarned.div(2));

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.be.gte(utils.parseEther('0.24'));
      expect(ownerDaiEarned).to.be.lte(utils.parseEther('0.26'));
      expect(ownerMaltEarned).to.be.gte(utils.parseEther('0.12'));
      expect(ownerMaltEarned).to.be.lte(utils.parseEther('0.13'));

      expect(await lpmine.totalBonded()).to.equal(depositAmount);

      const totalRewarded = await lpmine.totalBondedRewarded();
      const totalMaltRewarded = await lpmine.totalBondedMaltRewarded();
      const balance = await lpmine.balanceOfRewards(ownerAddress);
      const maltBalance = await lpmine.balanceOfMaltRewards(ownerAddress);

      expect(totalRewarded).to.be.gte(utils.parseEther('0.74'));
      expect(totalRewarded).to.be.lte(utils.parseEther('0.76'));
      expect(totalMaltRewarded).to.be.gte(utils.parseEther('0.37'));
      expect(totalMaltRewarded).to.be.lte(utils.parseEther('0.38'));

      expect(balance).to.be.gte(utils.parseEther('0.74'));
      expect(balance).to.be.lte(utils.parseEther('0.76'));
      expect(maltBalance).to.be.gte(utils.parseEther('0.37'));
      expect(maltBalance).to.be.lte(utils.parseEther('0.38'));

      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      // The rest
      expect(ownerDaiEarned).to.be.gte(utils.parseEther('0.74'));
      expect(ownerDaiEarned).to.be.lte(utils.parseEther('0.76'));
      expect(ownerMaltEarned).to.be.gte(utils.parseEther('0.37'));
      expect(ownerMaltEarned).to.be.lte(utils.parseEther('0.38'));

      await lpmine.withdraw(ownerDaiEarned, ownerMaltEarned);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(0);

      expect(await lpmine.totalBonded()).to.equal(depositAmount);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
    });

    it("Can declare reward after an unbond", async function() {
      // Declare rewards first
      let rewardAmount = utils.parseEther('1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to half way through the reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2)

      // Unbonding
      await lpmine.unbond(depositAmount);

      expect(await lpmine.totalBonded()).to.equal(0);
      expect(await lpmine.totalBondedRewarded()).to.equal(0);
      expect(await lpmine.totalBondedMaltRewarded()).to.equal(0);

      // TODO assert earned balance Wed 31 Mar 2021 14:58:20 BST

      // Declare a second reward now the withdraw has went through
      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);
      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);
    });

    it("Can declare reward after a withdrawal", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('1');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to half way through the first reward period
      currentEpoch = await advanceLpPool(payoutEpochs / 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      // Withdraw
      await lpmine.withdraw(ownerDaiEarned, ownerMaltEarned);

      expect(await lpmine.totalBonded()).to.equal(depositAmount);
      expect(await lpmine.totalBondedRewarded()).to.be.gte(utils.parseEther('0.49'));
      expect(await lpmine.totalBondedRewarded()).to.be.lte(utils.parseEther('0.51'));
      expect(await lpmine.totalBondedMaltRewarded()).to.be.gte(utils.parseEther('0.49'));
      expect(await lpmine.totalBondedMaltRewarded()).to.be.lte(utils.parseEther('0.51'));

      // Declare a second reward now the withdraw has went through
      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);
      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);
    });

    it("returns correct real value for bonded when user owns all liquidity", async function() {
      const ownerAddress = await owner.getAddress();

      // Some of the initial 1000usd is removed as minimum liquidity
      let balance = utils.parseEther('999.999999999999999000');

      const [maltValue, daiValue] = await lpmine.realValueOfBonded(ownerAddress);

      // The user owns the entire pool
      expect(maltValue).to.equal(balance);
      expect(daiValue).to.equal(balance);
    });

    it("returns correct real value for bonded when user owns half the liquidity", async function() {
      const ownerAddress = await owner.getAddress();
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();

      // Add more liquidity from another user
      let balance = utils.parseEther('1000');

      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      // Some of the initial 1000usd is removed as minimum liquidity
      let userbalance = utils.parseEther('999.999999999999999000');

      const [maltValue, daiValue] = await lpmine.realValueOfBonded(ownerAddress);

      expect(maltValue).to.equal(userbalance);
      expect(daiValue).to.equal(userbalance);

      const [maltValueTwo, daiValueTwo] = await lpmine.realValueOfBonded(otherAddress);

      expect(maltValueTwo).to.equal(0);
      expect(daiValueTwo).to.equal(0);

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      const [maltValueThree, daiValueThree] = await lpmine.realValueOfBonded(otherAddress);

      expect(maltValueThree).to.equal(balance);
      expect(daiValueThree).to.equal(balance);
    });

    it("allows users to reinvest all dai profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough malt to reinvest and approve lpmine
      await malt.mint(ownerAddress, ownerDaiEarned);
      await malt.approve(lpmine.address, ownerDaiEarned);

      // reinvest all the dai
      await lpmineReinvestor.reinvestReward(ownerDaiEarned, 0);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      // All dai has been reinvested so none should be available
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);
      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1100'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1100'));
    });

    it("allows users to reinvest all malt profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough dai to reinvest and approve lpmine
      await dai.mint(ownerAddress, ownerDaiEarned);
      await dai.approve(lpmine.address, ownerDaiEarned);

      // reinvest all the malt
      await lpmineReinvestor.reinvestMalt(ownerMaltEarned, 0);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(ownerDaiEarned);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);
      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1100'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1100'));
    });

    it("allows users to partially reinvest dai profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough malt to reinvest and approve lpmine
      await malt.mint(ownerAddress, ownerDaiEarned);
      await malt.approve(lpmine.address, ownerDaiEarned);

      // reinvest half of the dai
      await lpmineReinvestor.reinvestReward(ownerDaiEarned.div(2), 0);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      // Half of the dai has been reinvested so only half remains 
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(ownerDaiEarned.div(2));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1050'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1050'));
    });

    it("allows users to partially reinvest malt profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough dai to reinvest and approve lpmine
      await dai.mint(ownerAddress, ownerDaiEarned);
      await dai.approve(lpmine.address, ownerDaiEarned);

      // reinvest half the malt
      await lpmineReinvestor.reinvestMalt(ownerMaltEarned.div(2), 0);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(ownerDaiEarned);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned.div(2));
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);
      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1050'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1050'));
    });

    it("allows users to reinvest all dai and malt profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // reinvest all the dai
      await lpmineReinvestor.reinvestReward(ownerDaiEarned, ownerMaltEarned);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      // All dai has been reinvested so none should be available
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);
      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1100'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1100'));
    });

    it("allows users to reinvest all malt and dai profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // reinvest all the malt
      await lpmineReinvestor.reinvestMalt(ownerMaltEarned, ownerDaiEarned);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1100'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1100'));
    });

    it("allows users to partially reinvest dai and malt profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough malt to reinvest and approve lpmine
      await malt.mint(ownerAddress, ownerDaiEarned);
      await malt.approve(lpmine.address, ownerDaiEarned);

      // reinvest half of the dai and a quarter of the malt rewards
      await lpmineReinvestor.reinvestReward(ownerDaiEarned.div(2), ownerMaltEarned.div(4));

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      // Half of the dai has been reinvested so only half remains 
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(ownerDaiEarned.div(2));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount.mul(3).div(4));

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1050'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1050'));
    });

    it("allows users to partially reinvest malt and dai profits", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough dai to reinvest and approve lpmine
      await dai.mint(ownerAddress, ownerDaiEarned);
      await dai.approve(lpmine.address, ownerDaiEarned);

      // reinvest half the malt and a quarter of the dai
      await lpmineReinvestor.reinvestMalt(ownerMaltEarned.div(2), ownerDaiEarned.div(4));

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(ownerDaiEarned.mul(3).div(4));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned.div(2));
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1050'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1049.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1050'));
    });

    it("disallows early adopter bonus after 336 epochs", async function() {
      currentEpoch = await advanceLpPool(400);

      await expect(lpmineReinvestor.subsidizedReinvest(utils.parseEther('100'))).to.be.reverted;
    });

    it("disallows early adopter bonus when asking for more bonus than allowed", async function() {
      await expect(lpmineReinvestor.subsidizedReinvest(utils.parseEther('100'))).to.be.reverted;
    });

    it("allows claiming full early adopter bonus", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('1000');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Claim early adopter reward
      await lpmineReinvestor.subsidizedReinvest(ownerDaiEarned);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      // All dai is used
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      // No malt is used
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned);

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.be.above(0);
      const [finalSubsidizedMalt, finalSubsidizedDai] = await lpmine.realValueOfSubsidizedLP(ownerAddress);

      // rewardAmount extra malt is minted and given to the user to LP. That results in half the value
      // in malt and dai respectively
      expect(finalSubsidizedMalt).to.equal(rewardAmount.div(2));
      expect(finalSubsidizedMalt).to.equal(rewardAmount.div(2));

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1499.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1500'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1499.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1500'));
    });

    it("allows partial claiming early adopter bonus", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('1000');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Claim half of the early adopter reward
      await lpmineReinvestor.subsidizedReinvest(ownerDaiEarned.div(2));

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      // All dai is used
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(ownerDaiEarned.div(2));
      // No malt is used
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned);

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.be.above(0);
      const [finalSubsidizedMalt, finalSubsidizedDai] = await lpmine.realValueOfSubsidizedLP(ownerAddress);

      // half of rewardAmount extra malt is minted and given to the user to LP. 
      // That results in a quarter of the value in malt and dai respectively in LP tokens
      expect(finalSubsidizedMalt).to.equal(rewardAmount.div(4));
      expect(finalSubsidizedMalt).to.equal(rewardAmount.div(4));

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1249.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1250'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1249.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1250'));
    });

    it("Sends subsidized LP to treasury when early adopter unbonds", async function() {
      const ownerAddress = await owner.getAddress();
      const treasuryAddress = await treasury.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('1000');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      // Claim early adopter reward
      await lpmineReinvestor.subsidizedReinvest(ownerDaiEarned);

      // Move forward some more
      currentEpoch = await advanceLpPool(payoutEpochs)

      const secondBonded = await lpmine.balanceOfBonded(ownerAddress);

      const initialTreasuryLpBalance = await LPToken.balanceOf(treasuryAddress);
      const initialDai = await dai.balanceOf(ownerAddress);
      const initialMalt = await malt.balanceOf(ownerAddress);
      const initialLP = await LPToken.balanceOf(ownerAddress);

      await lpmine.unbond(secondBonded);

      const finalTreasuryLpBalance = await LPToken.balanceOf(treasuryAddress);
      const finalDai = await dai.balanceOf(ownerAddress);
      const finalMalt = await malt.balanceOf(ownerAddress);
      const finalLP = await LPToken.balanceOf(ownerAddress);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      const [maltLPValue, daiLPValue] = await maltPoolPeriphery.realValueOfLPToken(finalLP);

      expect(maltLPValue).to.be.gte(utils.parseEther('1499.99'));
      expect(maltLPValue).to.be.lte(utils.parseEther('1500'));
      expect(daiLPValue).to.be.gte(utils.parseEther('1499.99'));
      expect(daiLPValue).to.be.lte(utils.parseEther('1500'));

      expect(finalBonded).to.equal(0);
      // Subsidized LP is forfeited to the treasury
      expect(finalTreasuryLpBalance).to.be.above(initialTreasuryLpBalance);
      // All dai was used to reinvest LP so that reward is baked into the LP tokens now
      expect(finalDai).to.equal(0);

      // The malt is not withdrawn yet
      expect(finalMalt).to.equal(0);
      // LP tokens are withdrawn
      expect(finalLP).to.be.above(initialLP);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      // All their dai has been reinvested
      expect(ownerDaiEarned).to.equal(0);
      expect(ownerMaltEarned).to.equal(rewardAmount);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      await lpmine.withdraw(ownerDaiEarned, ownerMaltEarned);

      const withdrawDai = await dai.balanceOf(ownerAddress);
      const withdrawMalt = await malt.balanceOf(ownerAddress);

      expect(withdrawDai).to.equal(finalDai);
      expect(withdrawMalt).to.equal(finalMalt.add(ownerMaltEarned));
    });

    it("correctly assigns rewards to early adopters with subsidized LP", async function() {
      const ownerAddress = await owner.getAddress();

      // Add another LPer
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();

      // 1000usd on each side of pair in pool
      let balance = utils.parseEther('1000');

      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      // Move forward so new LP is eligible for reward
      currentEpoch = await advanceLpPool(2)

      // Declare rewards first
      let rewardAmount = utils.parseEther('1000');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);
      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);
      const otherInitialBonded = await lpmine.balanceOfBonded(otherAddress);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      const [otherInitialBondedMalt, otherInitialBondedDai] = await lpmine.realValueOfBonded(otherAddress);

      expect(otherInitialBondedDai).to.be.gte(utils.parseEther('999.99'));
      expect(otherInitialBondedDai).to.be.lte(utils.parseEther('1000'));
      expect(otherInitialBondedMalt).to.be.gte(utils.parseEther('999.99'));
      expect(otherInitialBondedMalt).to.be.lte(utils.parseEther('1000'));

      // reward split evenly between two accounts
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.gte(utils.parseEther('499.99'));
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.lte(utils.parseEther('500'));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.gte(utils.parseEther('499.99'));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.lte(utils.parseEther('500'));

      expect(await lpmine.balanceOfRewards(otherAddress)).to.be.gte(utils.parseEther('500'));
      expect(await lpmine.balanceOfRewards(otherAddress)).to.be.lte(utils.parseEther('500.01'));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.be.gte(utils.parseEther('500'));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.be.lte(utils.parseEther('500.01'));

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(ownerDaiEarned).to.be.gte(utils.parseEther('499.99'));
      expect(ownerDaiEarned).to.be.lte(utils.parseEther('500'));
      expect(ownerMaltEarned).to.be.gte(utils.parseEther('499.99'));
      expect(ownerMaltEarned).to.be.lte(utils.parseEther('500'));

      let [otherDaiEarned, otherMaltEarned] = await lpmine.earned(otherAddress);
      expect(otherDaiEarned).to.be.gte(utils.parseEther('500'));
      expect(otherDaiEarned).to.be.lte(utils.parseEther('500.01'));
      expect(otherMaltEarned).to.be.gte(utils.parseEther('500'));
      expect(otherMaltEarned).to.be.lte(utils.parseEther('500.01'));

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfSubsidizedLP(otherAddress)).to.equal(0);

      // Claim early adopter reward
      await lpmineReinvestor.subsidizedReinvest(ownerDaiEarned);

      // Reassert rewards after calling reinvest. Only owners DAI rewards should have changed
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.below(10); // dust to account for numerical error
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.gte(utils.parseEther('499.99'));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.lte(utils.parseEther('500'));

      expect(await lpmine.balanceOfRewards(otherAddress)).to.be.gte(utils.parseEther('500'));
      expect(await lpmine.balanceOfRewards(otherAddress)).to.be.lte(utils.parseEther('500.01'));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.be.gte(utils.parseEther('500'));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.be.lte(utils.parseEther('500.01'));

      // Advance epoch so newly bonded LP takes effect
      currentEpoch = await advanceLpPool(1)

      // declare new reward
      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);
      const otherFinalBonded = await lpmine.balanceOfBonded(otherAddress);

      // Owner bonded 500 dai rewards. 250 went into DAI LP and 250 went into Malt LP
      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(finalBondedDai).to.be.above(utils.parseEther('1249.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1250'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1249.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1250'));

      // Owner was also subsidised $500 more, which split across both sides of LP
      const [finalSubsidizedMalt, finalSubsidizedDai] = await lpmine.realValueOfSubsidizedLP(ownerAddress);

      expect(finalSubsidizedDai).to.be.above(utils.parseEther('249.99'));
      expect(finalSubsidizedDai).to.be.below(utils.parseEther('250'));
      expect(finalSubsidizedMalt).to.be.above(utils.parseEther('249.99'));
      expect(finalSubsidizedMalt).to.be.below(utils.parseEther('250'));

      // Other user should not have any subsidy
      const [otherFinalSubsidizedMalt, otherFinalSubsidizedDai] = await lpmine.realValueOfSubsidizedLP(otherAddress);
      expect(otherFinalSubsidizedMalt).to.equal(0);

      // Other user's bonded value should not have changed
      const [otherFinalBondedMalt, otherFinalBondedDai] = await lpmine.realValueOfBonded(otherAddress);

      expect(otherFinalBondedDai).to.be.gte(utils.parseEther('999.99'));
      expect(otherFinalBondedDai).to.be.lte(utils.parseEther('1000'));
      expect(otherFinalBondedMalt).to.be.gte(utils.parseEther('999.99'));
      expect(otherFinalBondedMalt).to.be.lte(utils.parseEther('1000'));

      // Owner now gets 3/5ths of rewards due to reinvestment.
      // Therefore gets 600 of the newly awared 1000 reward
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.gte(utils.parseEther('599.99'));
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.lte(utils.parseEther('600'));
      // Owner still had original 500 malt reward plus 600 new malt
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.gte(utils.parseEther('1099.99'));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.lte(utils.parseEther('1100'));

      // Other acount has previous 500 plus the new 400 = 900
      expect(await lpmine.balanceOfRewards(otherAddress)).to.be.gte(utils.parseEther('900'));
      expect(await lpmine.balanceOfRewards(otherAddress)).to.be.lte(utils.parseEther('900.01'));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.be.gte(utils.parseEther('900'));
      expect(await lpmine.balanceOfMaltRewards(otherAddress)).to.be.lte(utils.parseEther('900.01'));

      let [finalOwnerDaiEarned, finalOwnerMaltEarned] = await lpmine.earned(ownerAddress);
      expect(finalOwnerDaiEarned).to.be.gte(utils.parseEther('599.99'));
      expect(finalOwnerDaiEarned).to.be.lte(utils.parseEther('600'));
      expect(finalOwnerMaltEarned).to.be.gte(utils.parseEther('1099.99'));
      expect(finalOwnerMaltEarned).to.be.lte(utils.parseEther('1100'));

      let [finalOtherDaiEarned, finalOtherMaltEarned] = await lpmine.earned(otherAddress);
      expect(finalOtherDaiEarned).to.be.gte(utils.parseEther('900'));
      expect(finalOtherDaiEarned).to.be.lte(utils.parseEther('900.01'));
      expect(finalOtherMaltEarned).to.be.gte(utils.parseEther('900'));
      expect(finalOtherMaltEarned).to.be.lte(utils.parseEther('900.01'));

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.be.above(0);
      expect(await lpmine.balanceOfSubsidizedLP(otherAddress)).to.equal(0);
    });

    it("allows compound claiming early adopter bonus", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('1000');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Claim early adopter reward
      await lpmineReinvestor.subsidizedReinvest(ownerDaiEarned);

      const secondBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(secondBonded).to.be.above(initialBonded);
      // All dai is used
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      // No malt is used
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.be.above(0);

      const [secondSubsidizedMalt, secondSubsidizedDai] = await lpmine.realValueOfSubsidizedLP(ownerAddress);

      // rewardAmount extra malt is minted and given to the user to LP. That results in half the value
      // in malt and dai respectively
      expect(secondSubsidizedMalt).to.equal(rewardAmount.div(2));
      expect(secondSubsidizedMalt).to.equal(rewardAmount.div(2));

      const [secondBondedMalt, secondBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(secondBondedDai).to.be.above(utils.parseEther('1499.99'));
      expect(secondBondedDai).to.be.below(utils.parseEther('1500'));
      expect(secondBondedMalt).to.be.above(utils.parseEther('1499.99'));
      expect(secondBondedMalt).to.be.below(utils.parseEther('1500'));


      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2);

      [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      // Claim early adopter reward
      await lpmineReinvestor.subsidizedReinvest(ownerDaiEarned);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(secondBonded);
      // All dai is used
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      // No malt is used
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.be.above(0);

      const [finalSubsidizedMalt, finalSubsidizedDai] = await lpmine.realValueOfSubsidizedLP(ownerAddress);
      // rewardAmount extra malt is minted and given to the user to LP. That results in half the value
      // in malt and dai respectively, but the process was done twice so the subsidy = rewardAmount
      expect(finalSubsidizedMalt).to.equal(rewardAmount);
      expect(finalSubsidizedMalt).to.equal(rewardAmount);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      expect(finalBondedDai).to.be.above(utils.parseEther('1999.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('2000'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('1999.99'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('2000'));
    });

    it("allows users to compound reinvest all dai rewards", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough dai to reinvest and approve lpmine
      await dai.mint(ownerAddress, ownerDaiEarned);
      await dai.approve(lpmine.address, ownerDaiEarned);

      // reinvest all the dai
      await lpmineReinvestor.compoundReinvest(ownerDaiEarned);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned);
      // Nothing subsidised. All reinvest coming from rewards
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      // Due to price change of the reinvest the 100 reinvested
      // ends up entirely on the DAI side of the pair. This will 
      // recenter after a stabilize call
      expect(finalBondedDai).to.be.above(utils.parseEther('1099.99'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1100'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('997'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1000'));
    });

    it("allows users to compound reinvest all dai rewards", async function() {
      const ownerAddress = await owner.getAddress();

      // Declare rewards first
      let rewardAmount = utils.parseEther('100');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move to after full rewards having been earned
      currentEpoch = await advanceLpPool(payoutEpochs * 2)

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      const initialBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(rewardAmount);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(rewardAmount);

      const maltReward = await lpmine.balanceOfMaltRewards(ownerAddress);

      // console.log('maltReward', maltReward.toString());

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [initialBondedMalt, initialBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      expect(initialBondedDai).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedDai).to.be.below(utils.parseEther('1000'));
      expect(initialBondedMalt).to.be.above(utils.parseEther('999.99'));
      expect(initialBondedMalt).to.be.below(utils.parseEther('1000'));

      // Mint enough dai to reinvest and approve lpmine
      await dai.mint(ownerAddress, ownerDaiEarned);
      await dai.approve(lpmine.address, ownerDaiEarned);

      // reinvest all the dai
      await lpmineReinvestor.compoundReinvest(ownerDaiEarned.div(2));
      await lpmine.withdraw(ownerDaiEarned.div(2), 0);
      await lpmine.earned(ownerAddress);
      currentEpoch = await advanceLpPool(payoutEpochs * 2)
      await lpmine.earned(ownerAddress);

      const finalBonded = await lpmine.balanceOfBonded(ownerAddress);

      expect(finalBonded).to.be.above(initialBonded);
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.equal(0);
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.equal(ownerMaltEarned);
      // Nothing subsidised. All reinvest coming from rewards
      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      const [finalBondedMalt, finalBondedDai] = await lpmine.realValueOfBonded(ownerAddress);

      // All extra reward has been reinvested
      // Due to price change of the reinvest the 100 reinvested
      // ends up entirely on the DAI side of the pair. This will 
      // recenter after a stabilize call
      expect(finalBondedDai).to.be.above(utils.parseEther('1049.98'));
      expect(finalBondedDai).to.be.below(utils.parseEther('1050.02'));
      expect(finalBondedMalt).to.be.above(utils.parseEther('997'));
      expect(finalBondedMalt).to.be.below(utils.parseEther('1000'));
    });

    it("correctly calculates reward balance after reinvest after another user unbonds", async function() {
      const ownerAddress = await owner.getAddress();
      const otherAccount = accounts[0];
      const otherAddress = await otherAccount.getAddress();

      let balance = utils.parseEther('1000');

      // Bond another user
      await malt.mint(otherAddress, balance);
      await dai.mint(otherAddress, balance);

      await malt.connect(otherAccount).approve(router.address, balance);
      await dai.connect(otherAccount).approve(router.address, balance);

      const data = await router.connect(otherAccount).addLiquidity(
        malt.address,
        dai.address,
        balance,
        balance,
        balance,
        balance,
        otherAddress,
        new Date().getTime() + 10000,
      );

      let otherDepositAmount = await LPToken.balanceOf(otherAddress);
      await LPToken.connect(otherAccount).approve(lpmine.address, otherDepositAmount);

      await lpmine.connect(otherAccount).bond(otherDepositAmount);

      currentEpoch = await advanceLpPool(1);

      // Declare rewards first
      let rewardAmount = utils.parseEther('1000');

      await dai.mint(lpmine.address, rewardAmount);
      await malt.mint(lpmine.address, rewardAmount);

      await lpmine.connect(timelock).declareReward(rewardAmount);
      await lpmine.connect(timelock).declareMaltReward(rewardAmount);

      // Move halfway through the epoch
      currentEpoch = await advanceLpPool(payoutEpochs / 2);

      // Other account unbonds
      await lpmine.connect(otherAccount).unbond(otherDepositAmount);

      currentEpoch = await advanceLpPool(1);

      let [ownerDaiEarned, ownerMaltEarned] = await lpmine.earned(ownerAddress);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.above(rewardAmount.div(2).mul(99).div(100));
      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.below(rewardAmount.div(2));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.above(rewardAmount.div(2).mul(99).div(100));
      expect(await lpmine.balanceOfMaltRewards(ownerAddress)).to.be.below(rewardAmount.div(2));

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.equal(0);

      await lpmineReinvestor.subsidizedReinvest(ownerDaiEarned);

      expect(await lpmine.balanceOfSubsidizedLP(ownerAddress)).to.be.above(0);

      expect(await lpmine.balanceOfRewards(ownerAddress)).to.be.above(0);
    });
  });
});
