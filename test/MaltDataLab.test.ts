import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { UniswapHandler } from "../type/UniswapHandler";
import { LiquidityExtension } from "../type/LiquidityExtension";
import { MaltDataLab } from "../type/MaltDataLab";
import { DualMovingAverage } from "../type/DualMovingAverage";
import { Malt } from "../type/Malt";
import { ERC20 } from "../type/ERC20";
import { TransferService } from "../type/TransferService";
import { IUniswapV2Pair } from "../type/IUniswapV2Pair";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
import { hardhatSnapshot, hardhatRevert, setNextBlockTime } from "./helpers";
import IERC20 from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import MaltArtifacts from "../artifacts/contracts/Malt.sol/Malt.json";
import UniswapV2RouterBuild from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import UniswapV2FactoryBuild from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETHBuild from "@uniswap/v2-periphery/build/WETH9.json";
import DataLabArtifacts from "../artifacts/contracts/MaltDataLab.sol/MaltDataLab.json";

const UniswapV2FactoryBytecode = UniswapV2FactoryBuild.bytecode;
const UniswapV2FactoryAbi = UniswapV2FactoryBuild.abi;

const UniswapV2RouterBytecode = UniswapV2RouterBuild.bytecode;
const UniswapV2RouterAbi = UniswapV2RouterBuild.abi;
const WETHBytecode = WETHBuild.bytecode;
const WETHAbi = WETHBuild.abi;

const { deployMockContract } = waffle;

describe("MaltDataLab", function() {
  let accounts: Signer[];
  let owner: Signer;
  let admin: Signer;
  let updater: Signer;

  let maltDataLab: MaltDataLab;
  let dai: ERC20;
  let malt: ERC20;
  let snapshotId: string;

  let mockLiquidityExtension: LiquidityExtension;
  let mockPoolMA: DualMovingAverage;
  let mockTransferService: TransferService;
  let mockStakeToken: IUniswapV2Pair;

  const priceTarget = utils.parseEther('1');

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, admin, updater, ...accounts] = await ethers.getSigners();

    const ownerAddress = await owner.getAddress();
    const adminAddress = await admin.getAddress();
    const updaterAddress = await updater.getAddress();

    const ERC20Factory = await ethers.getContractFactory("Malt");

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

    mockLiquidityExtension = ((await deployMockContract(owner, [
      "function reserveRatio() returns (uint256, uint256)"
    ])) as any) as LiquidityExtension;
    mockPoolMA = ((await deployMockContract(owner, [
      "function getValueWithLookback(uint256) returns (uint256, uint256)",
      "function getValue() returns (uint256, uint256)",
      "function update(uint256, uint256)",
    ])) as any) as DualMovingAverage;
    mockStakeToken = ((await deployMockContract(owner, [
      "function totalSupply() returns (uint256)",
      "function getReserves() returns (uint256, uint256, uint256)",
      "function price0CumulativeLast() returns (uint256)",
      "function price1CumulativeLast() returns (uint256)",
      "function kLast() returns (uint256)",
    ])) as any) as IUniswapV2Pair;

    // Deploy the MaltDataLab
    const MaltDataLabFactory = await ethers.getContractFactory("MaltDataLab");

    maltDataLab = (await MaltDataLabFactory.deploy(
      ownerAddress,
      adminAddress,
      malt.address,
      dai.address,
      mockStakeToken.address,
      priceTarget,
      mockPoolMA.address,
    )) as MaltDataLab;

    await malt.initialSupplyControlSetup([ownerAddress], []);
    await dai.initialSupplyControlSetup([ownerAddress], []);
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    expect(await maltDataLab.stakeToken()).to.equal(mockStakeToken.address);
    expect(await maltDataLab.rewardToken()).to.equal(dai.address);
    expect(await maltDataLab.malt()).to.equal(malt.address);
    expect(await maltDataLab.poolMA()).to.equal(mockPoolMA.address);
    expect(await maltDataLab.priceTarget()).to.equal(priceTarget);
    expect(await maltDataLab.kLookback()).to.equal(60 * 30); // 30 minutes
    expect(await maltDataLab.maltPriceLookback()).to.equal(60 * 10); // 10 minutes
    expect(await maltDataLab.reserveLookback()).to.equal(60 * 15); // 15 minutes
  });

  it("Returns correct value from maltPriceMA when calling smoothedMaltPrice", async function() {
    // Should revert due to lack of mocks
    await expect(maltDataLab.smoothedMaltPrice()).to.be.reverted;

    const value = utils.parseEther('0.984');
    await mockPoolMA.mock.getValueWithLookback.withArgs(600).returns(value, 0);

    const maltPrice = await maltDataLab.smoothedMaltPrice();
    expect(maltPrice).to.equal(value);
  });

  it("Returns correct values using average malt price and reserves when calling smoothedReserves", async function() {
    // Should revert due to lack of mocks
    await expect(maltDataLab.smoothedReserves()).to.be.reverted;

    const mockPrice = utils.parseEther('9');
    const mockRootK = utils.parseEther('3000');
    await mockPoolMA.mock.getValueWithLookback.withArgs(900).returns(mockPrice, mockRootK);

    // mockRootK / sqrt(mockPrice) = 3000 / 3
    const mockMaltReserves = utils.parseEther('1000');
    // 1000 malt priced at $9
    const mockRewardReserves = utils.parseEther('9000');

    const [maltReserves, rewardReserves] = await maltDataLab.smoothedReserves();
    expect(maltReserves).to.equal(mockMaltReserves);
    expect(rewardReserves).to.equal(mockRewardReserves);
  });

  it("Returns correct values using smoothedK", async function() {
    // Should revert due to lack of mocks
    await expect(maltDataLab.smoothedK()).to.be.reverted;

    const mockPrice = utils.parseEther('9');
    const mockRootK = utils.parseEther('3000');
    await mockPoolMA.mock.getValueWithLookback.withArgs(1800).returns(mockPrice, mockRootK);

    // mockRootK squared
    const mockK = utils.parseEther('9000000000000000000000000');

    const averageK = await maltDataLab.smoothedK();
    expect(averageK).to.equal(mockK);
  });

  it("Returns correct value from maltPriceMA when calling maltPriceAverage", async function() {
    const lookback = 300;
    // Should revert due to lack of mocks
    await expect(maltDataLab.maltPriceAverage(lookback)).to.be.reverted;

    const value = utils.parseEther('0.97');
    await mockPoolMA.mock.getValueWithLookback.withArgs(lookback).returns(value, 0);

    const priceAverage = await maltDataLab.maltPriceAverage(lookback);
    expect(priceAverage).to.equal(value);
  });

  it("Returns correct value from poolMA when calling kAverage", async function() {
    const lookback = 300;
    // Should revert due to lack of mocks
    await expect(maltDataLab.kAverage(lookback)).to.be.reverted;

    // Don't care about price in this test
    const rootK = utils.parseEther('3000');
    await mockPoolMA.mock.getValueWithLookback.withArgs(lookback).returns(0, rootK);

    // 3000 squared
    const mockK = utils.parseEther('9000000000000000000000000');

    const averageK = await maltDataLab.kAverage(lookback);
    expect(averageK).to.equal(mockK);
  });

  it("Returns correct value from poolMA when calling poolReservesAverage", async function() {
    const lookback = 300;
    // Should revert due to lack of mocks
    await expect(maltDataLab.kAverage(lookback)).to.be.reverted;

    const mockPrice = utils.parseEther('9');
    const rootK = utils.parseEther('3000');
    await mockPoolMA.mock.getValueWithLookback.withArgs(lookback).returns(mockPrice, rootK);

    // 3000 squared
    const mockK = utils.parseEther('9000000');

    // mockRootK / sqrt(mockPrice) = 3000 / 3
    const mockMaltReserves = utils.parseEther('1000');
    // 1000 malt priced at $9
    const mockRewardReserves = utils.parseEther('9000');

    const [maltReserves, rewardReserves] = await maltDataLab.poolReservesAverage(lookback);
    expect(maltReserves).to.equal(mockMaltReserves);
    expect(rewardReserves).to.equal(mockRewardReserves);
  });

  it("Correctly handles calculating realValueOfLPToken", async function() {
    const amount = utils.parseEther('100');
    // No mocks
    await expect(maltDataLab.realValueOfLPToken(amount)).to.be.reverted;

    const mockPrice = utils.parseEther('9');
    const rootK = utils.parseEther('3000');
    await mockPoolMA.mock.getValueWithLookback.withArgs(900).returns(mockPrice, rootK);

    // mockRootK / sqrt(mockPrice) = 3000 / 3
    const mockMaltReserves = utils.parseEther('1000');
    // 1000 malt priced at $9
    const mockRewardReserves = utils.parseEther('9000');

    const totalSupply = utils.parseEther('10000');
    await mockStakeToken.mock.totalSupply.returns(totalSupply);

    const maltValue = amount.mul(mockMaltReserves).div(totalSupply);
    const rewardValue = amount.mul(mockRewardReserves).div(totalSupply);
    const maltRewardValue = maltValue.mul(mockPrice).div(priceTarget);

    expect(await maltDataLab.realValueOfLPToken(amount)).to.equal(rewardValue.add(maltRewardValue));
  });

  it("Correctly handles tracking the pool", async function() {
    const updaterAddress = await updater.getAddress();

    const now = Math.floor(new Date().getTime() / 1000) + 100;
    const price = utils.parseEther('1');
    await setNextBlockTime(now)
    await mockStakeToken.mock.price0CumulativeLast.returns(price);
    await mockStakeToken.mock.price1CumulativeLast.returns(price);
    const mockMaltReserves = utils.parseEther('4500');
    const mockRewardReserves = utils.parseEther('2000');
    await mockStakeToken.mock.getReserves.returns(mockMaltReserves, mockRewardReserves, now);
    await mockStakeToken.mock.kLast.returns(mockMaltReserves.mul(mockRewardReserves));

    const rootK = utils.parseEther('3000');

    await mockPoolMA.mock.update.withArgs(
      price, rootK
    ).returns();

    await maltDataLab.trackPool();
  });

  it("Returns 0 when there are no maltReserves", async function() {
    const amount = utils.parseEther('100');
    // No mocks
    await expect(maltDataLab.realValueOfLPToken(amount)).to.be.reverted;

    const mockPrice = utils.parseEther('9');
    const rootK = utils.parseEther('0');
    await mockPoolMA.mock.getValueWithLookback.withArgs(900).returns(mockPrice, rootK);

    const lpValue = await maltDataLab.realValueOfLPToken(amount);
    expect(lpValue).to.equal(0);
  });

  it("Only allows admin to set malt pool average contract", async function() {
    const [newContract, newContract2, user, user2] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(maltDataLab.connect(user).setMaltPoolAverageContract(newAddress)).to.be.reverted;
    await expect(maltDataLab.connect(user2).setMaltPoolAverageContract(newAddress)).to.be.reverted;

    await maltDataLab.connect(admin).setMaltPoolAverageContract(newAddress);
    expect(await maltDataLab.poolMA()).to.equal(newAddress);

    await maltDataLab.setMaltPoolAverageContract(new2Address);
    expect(await maltDataLab.poolMA()).to.equal(new2Address);
  });

  it("It only allows admins to update price target", async function() {
    expect(await maltDataLab.priceTarget()).to.equal(priceTarget);

    const [user, user2] = accounts;

    let newTarget = utils.parseEther('2');
    await expect(maltDataLab.connect(user).setPriceTarget(newTarget)).to.be.reverted;
    await expect(maltDataLab.connect(user2).setPriceTarget(newTarget)).to.be.reverted;

    await maltDataLab.connect(admin).setPriceTarget(newTarget);
    expect(await maltDataLab.priceTarget()).to.equal(newTarget);

    newTarget = utils.parseEther('3');
    // Default signer has the Timelock role
    await maltDataLab.setPriceTarget(newTarget);
    expect(await maltDataLab.priceTarget()).to.equal(newTarget);
  });

  it("It only allows admins to update reserve lookback", async function() {
    expect(await maltDataLab.reserveLookback()).to.equal(900);

    const [user, user2] = accounts;

    let newLookback = 230;
    await expect(maltDataLab.connect(user).setReserveLookback(newLookback)).to.be.reverted;
    await expect(maltDataLab.connect(user2).setReserveLookback(newLookback)).to.be.reverted;

    await maltDataLab.connect(admin).setReserveLookback(newLookback);
    expect(await maltDataLab.reserveLookback()).to.equal(newLookback);

    newLookback = 389;
    // Default signer has the Timelock role
    await maltDataLab.setReserveLookback(newLookback);
    expect(await maltDataLab.reserveLookback()).to.equal(newLookback);
  });

  it("It only allows admins to update malt price lookback", async function() {
    expect(await maltDataLab.maltPriceLookback()).to.equal(600);

    const [user, user2] = accounts;

    let newLookback = 230;
    await expect(maltDataLab.connect(user).setMaltPriceLookback(newLookback)).to.be.reverted;
    await expect(maltDataLab.connect(user2).setMaltPriceLookback(newLookback)).to.be.reverted;

    await maltDataLab.connect(admin).setMaltPriceLookback(newLookback);
    expect(await maltDataLab.maltPriceLookback()).to.equal(newLookback);

    newLookback = 389;
    // Default signer has the Timelock role
    await maltDataLab.setMaltPriceLookback(newLookback);
    expect(await maltDataLab.maltPriceLookback()).to.equal(newLookback);
  });

  it("It only allows admins to update k lookback", async function() {
    expect(await maltDataLab.kLookback()).to.equal(1800);

    const [user, user2] = accounts;

    let newLookback = 230;
    await expect(maltDataLab.connect(user).setKLookback(newLookback)).to.be.reverted;
    await expect(maltDataLab.connect(user2).setKLookback(newLookback)).to.be.reverted;

    await maltDataLab.connect(admin).setKLookback(newLookback);
    expect(await maltDataLab.kLookback()).to.equal(newLookback);

    newLookback = 389;
    // Default signer has the Timelock role
    await maltDataLab.setKLookback(newLookback);
    expect(await maltDataLab.kLookback()).to.equal(newLookback);
  });
});
