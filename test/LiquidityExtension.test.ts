import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { Signer } from "ethers";
import { UniswapHandler } from "../type/UniswapHandler";
import { LiquidityExtension } from "../type/LiquidityExtension";
import { MaltDataLab } from "../type/MaltDataLab";
import { Malt } from "../type/Malt";
import { TransferService } from "../type/TransferService";
import { ERC20 } from "../type/ERC20";
import { ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
import { hardhatSnapshot, hardhatRevert, increaseTime } from "./helpers";
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

describe("Liquidity Extension", function() {
  let accounts: Signer[];
  let owner: Signer;
  let admin: Signer;
  let auction: Signer;

  let uniswapHandler: UniswapHandler;
  let liquidityExtension: LiquidityExtension;
  let dai: ERC20;
  let malt: ERC20;
  let snapshotId: string;
  let mockDataLab: MaltDataLab;
  let mockTransferService: TransferService;

  let weth: Contract;
  let router: any;
  let factory: any;

  let maltReserves = utils.parseEther('10000000');
  let daiReserves = utils.parseEther('10000000');

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, admin, auction, ...accounts] = await ethers.getSigners();

    const ownerAddress = await owner.getAddress();
    const adminAddress = await admin.getAddress();
    const auctionAddress = await auction.getAddress();

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
    mockDataLab = ((await deployMockContract(owner, DataLabArtifacts.abi)) as any) as MaltDataLab;
    await mockDataLab.mock.priceTarget.returns(utils.parseEther('1'));

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

    // Deploy the UniswapHandler
    const UniswapHandlerFactory = await ethers.getContractFactory("UniswapHandler");

    uniswapHandler = (await UniswapHandlerFactory.deploy(
      ownerAddress,
      adminAddress,
      malt.address,
      dai.address,
      lpTokenAddress,
      router.address,
      mockDataLab.address,
    )) as UniswapHandler;
    await uniswapHandler.deployed();

    // Deploy the LiquidityExtension
    const LiquidityExtensionFactory = await ethers.getContractFactory("LiquidityExtension");

    liquidityExtension = (await LiquidityExtensionFactory.deploy(
      ownerAddress,
      adminAddress,
      auctionAddress,
      dai.address,
      malt.address,
      uniswapHandler.address,
      mockDataLab.address,
    )) as LiquidityExtension;

    await malt.initialSupplyControlSetup([ownerAddress], [liquidityExtension.address]);
    await dai.initialSupplyControlSetup([ownerAddress], []);

    await malt.mint(uniswapHandler.address, maltReserves);
    await dai.mint(uniswapHandler.address, daiReserves);
    await mockDataLab.mock.smoothedK.returns(daiReserves.mul(daiReserves));
    await mockDataLab.mock.maltPriceAverage.returns(utils.parseEther('1'));

    const LIQUIDITY_ADDER_ROLE = utils.id("LIQUIDITY_ADDER_ROLE");
    await uniswapHandler.connect(admin).grantRole(LIQUIDITY_ADDER_ROLE, ownerAddress);

    await uniswapHandler.addLiquidity(maltReserves, daiReserves, 10000);

    const BUYER_ROLE = utils.id("BUYER_ROLE");
    await uniswapHandler.connect(admin).grantRole(BUYER_ROLE, liquidityExtension.address);
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    const auctionAddress = await auction.getAddress();

    expect(await liquidityExtension.malt()).to.equal(malt.address);
    expect(await liquidityExtension.collateralToken()).to.equal(dai.address);
    expect(await liquidityExtension.auction()).to.equal(auctionAddress);
    expect(await liquidityExtension.dexHandler()).to.equal(uniswapHandler.address);
    expect(await liquidityExtension.maltDataLab()).to.equal(mockDataLab.address);
    expect(await liquidityExtension.minReserveRatioBps()).to.equal(4000);
  });

  it("Returns false for hasMinimumReserves when no reserves are present", async function() {
    expect(await liquidityExtension.hasMinimumReserves()).to.equal(false);
  });

  it("Returns true for hasMinimumReserves when sufficient reserves are present", async function() {
    await dai.mint(liquidityExtension.address, daiReserves.mul(10));
    expect(await liquidityExtension.hasMinimumReserves()).to.equal(true);
  });

  it("Handles hasMinimumReserves correctly with collateralDeficit", async function() {
    const [deficit, decimals] = await liquidityExtension.collateralDeficit();

    // Mint 1 less than the deficit
    await dai.mint(liquidityExtension.address, deficit.sub(1));
    expect(await liquidityExtension.hasMinimumReserves()).to.equal(false);

    // Mint the remaining 1
    await dai.mint(liquidityExtension.address, 1);
    expect(await liquidityExtension.hasMinimumReserves()).to.equal(true);
  });

  it("Returns the correct reserve ratio when there are no reserves", async function() {
    await mockDataLab.mock.smoothedK.returns(0);
    const [reserves, decimals] = await liquidityExtension.reserveRatio();
    expect(reserves).to.equal(0);
    expect(decimals).to.equal(18);
  });

  it("Returns the correct reserve ratio when there are reserves", async function() {
    await dai.mint(liquidityExtension.address, daiReserves.div(2));
    let reserves = await liquidityExtension.reserveRatio();
    expect(reserves[0]).to.equal(utils.parseEther('0.5'));
    expect(reserves[1]).to.equal(18);

    await dai.mint(liquidityExtension.address, daiReserves.div(4));
    reserves = await liquidityExtension.reserveRatio();
    expect(reserves[0]).to.equal(utils.parseEther('0.75'));
    expect(reserves[1]).to.equal(18);
  });

  it("Returns the correct collateral deficit", async function() {
    await dai.mint(liquidityExtension.address, daiReserves.div(5));
    let [reserves, decimals] = await liquidityExtension.reserveRatio();
    expect(reserves).to.equal(utils.parseEther('0.2'));
    expect(decimals).to.equal(18);

    let [deficit, deficitDecimals] = await liquidityExtension.collateralDeficit();
    // Deficit is 20%
    expect(deficit).to.equal(daiReserves.mul(2).div(10));
    expect(deficitDecimals).to.equal(18);
  });

  it("Disallows non auction role from calling purchaseAndBurn", async function() {
    const [user] = accounts;
    await expect(liquidityExtension.connect(admin).purchaseAndBurn(10)).to.be.reverted;
    await expect(liquidityExtension.connect(user).purchaseAndBurn(10)).to.be.reverted;
  });

  it("Can purchase amount burn", async function() {
    const daiBalance = daiReserves.mul(2);
    await dai.mint(liquidityExtension.address, daiBalance);

    const daiUsage = utils.parseEther('100');

    await liquidityExtension.connect(auction).purchaseAndBurn(daiUsage);

    const finalDaiBalance = await dai.balanceOf(liquidityExtension.address);
    expect(finalDaiBalance).to.equal(daiBalance.sub(daiUsage));
  });

  it("Reverts when requesting to burn too much", async function() {
    const daiBalance = daiReserves.mul(2);
    await dai.mint(liquidityExtension.address, daiBalance);

    await expect(liquidityExtension.connect(auction).purchaseAndBurn(daiBalance.mul(2))).to.be.reverted;
  });

  it("Allows admins to set new auction contract", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(liquidityExtension.connect(user).setAuction(newAddress)).to.be.reverted;
    await expect(liquidityExtension.connect(auction).setAuction(newAddress)).to.be.reverted;

    await liquidityExtension.connect(admin).setAuction(newAddress);
    expect(await liquidityExtension.auction()).to.equal(newAddress);

    await liquidityExtension.setAuction(new2Address);
    expect(await liquidityExtension.auction()).to.equal(new2Address);
  });

  it("Allows admins to set new dex handler contract", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(liquidityExtension.connect(user).setDexHandler(newAddress)).to.be.reverted;
    await expect(liquidityExtension.connect(auction).setDexHandler(newAddress)).to.be.reverted;

    await liquidityExtension.connect(admin).setDexHandler(newAddress);
    expect(await liquidityExtension.dexHandler()).to.equal(newAddress);

    await liquidityExtension.setDexHandler(new2Address);
    expect(await liquidityExtension.dexHandler()).to.equal(new2Address);
  });

  it("Allows admins to set new malt data lab contract", async function() {
    const [newContract, newContract2, user] = accounts;
    const newAddress = await newContract.getAddress();
    const new2Address = await newContract2.getAddress();

    await expect(liquidityExtension.connect(user).setMaltDataLab(newAddress)).to.be.reverted;
    await expect(liquidityExtension.connect(auction).setMaltDataLab(newAddress)).to.be.reverted;

    await liquidityExtension.connect(admin).setMaltDataLab(newAddress);
    expect(await liquidityExtension.maltDataLab()).to.equal(newAddress);

    await liquidityExtension.setMaltDataLab(new2Address);
    expect(await liquidityExtension.maltDataLab()).to.equal(new2Address);
  });

  it("Allows admins to set new minReserveRatio", async function() {
    const [user] = accounts;
    const newReserveRatio = 20;
    await expect(liquidityExtension.connect(user).setMinReserveRatio(newReserveRatio)).to.be.reverted;
    await expect(liquidityExtension.connect(auction).setMinReserveRatio(newReserveRatio)).to.be.reverted;

    await liquidityExtension.connect(admin).setMinReserveRatio(newReserveRatio);
    expect(await liquidityExtension.minReserveRatioBps()).to.equal(newReserveRatio);

    const newReserveRatio2 = 40;
    await liquidityExtension.setMinReserveRatio(newReserveRatio2);
    expect(await liquidityExtension.minReserveRatioBps()).to.equal(newReserveRatio2);
  });
});
