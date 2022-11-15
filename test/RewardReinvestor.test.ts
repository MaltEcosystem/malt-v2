import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { UniswapHandler } from "../type/UniswapHandler";
import { RewardReinvestor } from "../type/RewardReinvestor";
import { Bonding } from "../type/Bonding";
import { MiningService } from "../type/MiningService";
import { TransferService } from "../type/TransferService";
import { Malt } from "../type/Malt";
import { MaltDataLab } from "../type/MaltDataLab";
import { ERC20 } from "../type/ERC20";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
import { hardhatSnapshot, hardhatRevert, increaseTime } from "./helpers";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import MaltArtifacts from "../artifacts/contracts/Malt.sol/Malt.json";
import UniswapV2RouterBuild from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import UniswapV2FactoryBuild from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETHBuild from "@uniswap/v2-periphery/build/WETH9.json";
import RewardThrottleArtifacts from "../artifacts/contracts/RewardSystem/RewardThrottle.sol/RewardThrottle.json";

const UniswapV2FactoryBytecode = UniswapV2FactoryBuild.bytecode;
const UniswapV2FactoryAbi = UniswapV2FactoryBuild.abi;

const UniswapV2RouterBytecode = UniswapV2RouterBuild.bytecode;
const UniswapV2RouterAbi = UniswapV2RouterBuild.abi;
const WETHBytecode = WETHBuild.bytecode;
const WETHAbi = WETHBuild.abi;

const { deployMockContract } = waffle;

describe("RewardReinvestor", function() {
  let accounts: Signer[];
  let owner: Signer;
  let treasury: Signer;
  let admin: Signer;
  let stabilizerNode: Signer;

  let uniswapHandler: UniswapHandler;
  let rewardReinvestor: RewardReinvestor;
  let dai: ERC20;
  let malt: ERC20;
  let snapshotId: string;
  let mockBonding: Bonding;
  let mockMiningService: MiningService;
  let mockTransferService: TransferService;
  let mockDataLab: MaltDataLab;

  let weth: Contract;
  let router: any;
  let factory: any;

  let maltReserves = utils.parseEther('10000000');
  let daiReserves = utils.parseEther('10000000');

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, admin, stabilizerNode, treasury, ...accounts] = await ethers.getSigners();

    const ownerAddress = await owner.getAddress();
    const adminAddress = await admin.getAddress();
    const stabilizerNodeAddress = await stabilizerNode.getAddress();
    const treasuryAddress = await treasury.getAddress();

    const ERC20Factory = await ethers.getContractFactory("Malt");

    // Deploy Uniswap Contracts
    const routerContract = new ContractFactory(UniswapV2RouterAbi, UniswapV2RouterBytecode, owner);
    const wethContract = new ContractFactory(WETHAbi, WETHBytecode, owner);

    const factoryContract = new ContractFactory(UniswapV2FactoryAbi, UniswapV2FactoryBytecode, owner);
    factory = await factoryContract.deploy(constants.AddressZero);

    weth = await wethContract.deploy();
    await weth.deployed();
    router = await routerContract.deploy(factory.address, weth.address);
    await router.deployed();

    mockTransferService = ((await deployMockContract(owner, [
      "function verifyTransferAndCall(address, address, uint256) returns (bool, string memory)"
    ])) as any) as TransferService;
    await mockTransferService.mock.verifyTransferAndCall.returns(true, "");

    // Deploy ERC20 tokens
    malt = (await ERC20Factory.deploy(
      "Malt Stablecoin",
      "MALT",
      ownerAddress,
      adminAddress,
      mockTransferService.address,
    )) as Malt;
    dai = (await ERC20Factory.deploy(
      "Dai Stablecoin",
      "DAI",
      ownerAddress,
      adminAddress,
      mockTransferService.address,
    )) as Malt;

    await malt.deployed();
    await dai.deployed();

    await factory.createPair(malt.address, dai.address);
    const lpTokenAddress = await factory.getPair(malt.address, dai.address);

    mockDataLab = ((await deployMockContract(owner, [
      "function maltPriceAverage(uint256) returns (uint256)",
      "function poolReservesAverage(uint256) returns (uint256, uint256)",
    ])) as any) as MaltDataLab;
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('1'));

    // Deploy the UniswapHandler
    const UniswapHandlerFactory = await ethers.getContractFactory("UniswapHandler");

    uniswapHandler = (await UniswapHandlerFactory.deploy(
      ownerAddress,
      adminAddress,
      malt.address,
      dai.address,
      lpTokenAddress,
      router.address,
      mockDataLab.address
    )) as UniswapHandler;
    await uniswapHandler.deployed();

    // Create the mock reward throttle
    mockBonding = ((await deployMockContract(owner, ["function bondToAccount(address, uint256, uint256)"])) as any) as Bonding;
    mockMiningService = ((await deployMockContract(owner, ["function withdrawRewardsForAccount(address, uint256, uint256)"])) as any) as MiningService;

    // Deploy the RewardReinvestor
    const RewardReinvestorFactory = await ethers.getContractFactory("RewardReinvestor");

    rewardReinvestor = (await RewardReinvestorFactory.deploy(
      ownerAddress,
      adminAddress,
      malt.address,
      dai.address,
      factory.address,
      treasuryAddress
    )) as RewardReinvestor;
    await uniswapHandler.deployed();
    await rewardReinvestor.setupContracts(
      uniswapHandler.address,
      mockBonding.address,
      mockMiningService.address,
    );

    await malt.mint(uniswapHandler.address, maltReserves);
    await dai.mint(uniswapHandler.address, daiReserves);

    const LIQUIDITY_ADDER_ROLE = utils.id("LIQUIDITY_ADDER_ROLE");
    await uniswapHandler.connect(admin).grantRole(LIQUIDITY_ADDER_ROLE, ownerAddress);
    await uniswapHandler.connect(admin).grantRole(LIQUIDITY_ADDER_ROLE, rewardReinvestor.address);
    await uniswapHandler.addLiquidity(maltReserves, daiReserves, 10000);

    const BUYER_ROLE = utils.id("BUYER_ROLE");
    await uniswapHandler.connect(admin).grantRole(BUYER_ROLE, rewardReinvestor.address);

    await malt.initialSupplyControlSetup([ownerAddress], []);
    await dai.initialSupplyControlSetup([ownerAddress], []);
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    let pair = await factory.getPair(malt.address, dai.address);
    expect(await rewardReinvestor.malt()).to.equal(malt.address);
    expect(await rewardReinvestor.rewardToken()).to.equal(dai.address);
    expect(await rewardReinvestor.stakeToken()).to.equal(pair);
    expect(await rewardReinvestor.dexHandler()).to.equal(uniswapHandler.address);
    expect(await rewardReinvestor.bonding()).to.equal(mockBonding.address);
    expect(await rewardReinvestor.miningService()).to.equal(mockMiningService.address);
  });

  it("Handles provideReinvest", async function() {
    let pair = await factory.getPair(malt.address, dai.address);
    let LPToken = (new Contract(pair, IERC20.abi, owner)) as ERC20;
    const [user] = accounts;
    const userAddress = await user.getAddress();

    const amount = utils.parseEther('1000');

    // No mocks yet
    await expect(rewardReinvestor.connect(user).provideReinvest(0, amount, amount, 500)).to.be.reverted;

    await mockMiningService.mock.withdrawRewardsForAccount.withArgs(userAddress, 0, amount).returns();
    await expect(rewardReinvestor.connect(user).provideReinvest(0, amount, amount, 500)).to.be.reverted;
    await mockBonding.mock.bondToAccount.withArgs(userAddress, 0, amount).returns();

    const balance = utils.parseEther('10000');

    await malt.mint(userAddress, balance);
    await malt.connect(user).approve(rewardReinvestor.address, balance);

    // Instead of withdraw sending the tokens they are just minted directly due to
    // the withdraw method being mocked
    await dai.mint(rewardReinvestor.address, amount);

    await rewardReinvestor.connect(user).provideReinvest(0, amount, amount, 500);

    // Typically it bondToAccount would have transfered it to the bonding contract
    // But due to that being mocked it is still in the rewardReinvestor contract
    expect(await LPToken.balanceOf(rewardReinvestor.address)).to.equal(amount);
  });

  it("Disallows provideReinvest with 0 amount", async function() {
    const [user] = accounts;
    const userAddress = await user.getAddress();

    await mockMiningService.mock.withdrawRewardsForAccount.withArgs(userAddress, 0, 0).returns();

    await expect(rewardReinvestor.connect(user).provideReinvest(0, 0, 100, 500)).to.be.revertedWith("Cannot reinvest 0");
  });

  it("Handles splitReinvest", async function() {
    let pair = await factory.getPair(malt.address, dai.address);
    let LPToken = (new Contract(pair, IERC20.abi, owner)) as ERC20;
    const [user] = accounts;
    const userAddress = await user.getAddress();

    const amount = utils.parseEther('1000');

    // No mocks yet
    await expect(rewardReinvestor.connect(user).splitReinvest(0, amount, daiReserves, 500)).to.be.reverted;

    const expectedLP = utils.parseEther('499.236392740318659703');
    await mockMiningService.mock.withdrawRewardsForAccount.withArgs(userAddress, 0, amount).returns();
    await expect(rewardReinvestor.connect(user).splitReinvest(0, amount, daiReserves, 500)).to.be.reverted;
    await mockBonding.mock.bondToAccount.withArgs(userAddress, 0, expectedLP).returns();

    // Instead of withdraw sending the tokens they are just minted directly due to
    // the withdraw method being mocked
    await dai.mint(rewardReinvestor.address, amount);

    await rewardReinvestor.connect(user).splitReinvest(0, amount, daiReserves, 500);

    // Typically it bondToAccount would have transfered it to the bonding contract
    // But due to that being mocked it is still in the rewardReinvestor contract
    expect(await LPToken.balanceOf(rewardReinvestor.address)).to.equal(expectedLP);
  });

  it("Disallows splitReinvest with 0 amount", async function() {
    const [user] = accounts;
    const userAddress = await user.getAddress();

    await mockMiningService.mock.withdrawRewardsForAccount.withArgs(userAddress, 0, 0).returns();

    await expect(rewardReinvestor.connect(user).splitReinvest(0, 0, daiReserves, 500)).to.be.revertedWith("Cannot reinvest 0");
  });

  it("Only allows admin to set dex handler", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(rewardReinvestor.connect(user).setDexHandler(newAddress)).to.be.reverted;
    await expect(rewardReinvestor.connect(stabilizerNode).setDexHandler(newAddress)).to.be.reverted;

    await rewardReinvestor.connect(admin).setDexHandler(newAddress);
    expect(await rewardReinvestor.dexHandler()).to.equal(newAddress);

    await rewardReinvestor.setDexHandler(new2Address);
    expect(await rewardReinvestor.dexHandler()).to.equal(new2Address);
  });

  it("Only allows admin to set bonding", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(rewardReinvestor.connect(user).setBonding(newAddress)).to.be.reverted;
    await expect(rewardReinvestor.connect(stabilizerNode).setBonding(newAddress)).to.be.reverted;

    await rewardReinvestor.connect(admin).setBonding(newAddress);
    expect(await rewardReinvestor.bonding()).to.equal(newAddress);

    await rewardReinvestor.setBonding(new2Address);
    expect(await rewardReinvestor.bonding()).to.equal(new2Address);
  });

  it("Only allows admin to set mining service", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(rewardReinvestor.connect(user).setMiningService(newAddress)).to.be.reverted;
    await expect(rewardReinvestor.connect(stabilizerNode).setMiningService(newAddress)).to.be.reverted;

    await rewardReinvestor.connect(admin).setMiningService(newAddress);
    expect(await rewardReinvestor.miningService()).to.equal(newAddress);

    await rewardReinvestor.setMiningService(new2Address);
    expect(await rewardReinvestor.miningService()).to.equal(new2Address);
  });
});
