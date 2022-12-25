import hre, { ethers } from "hardhat";
async function main() {
  let tx, receipt;
  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const verifyingSigner = "0x416B03E2E5476B6a2d1dfa627B404Da1781e210d";

  const SingletonGasTank = await ethers.getContractFactory(
    "SingletonGasTank"
  );
  const gasTank = await SingletonGasTank.deploy(
    verifyingSigner
  );
  tx = await gasTank.deployed();
  console.log("SingletonGasTank deployed at: ", gasTank.address);

  tx = await gasTank.transferOwnership(owner);
  receipt = await tx.wait();
  console.log(`Singleton gas tank ownership transferred to ${owner}`);

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
