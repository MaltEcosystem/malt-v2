# Permissioning System

All contracts inherit from the Permissions contract that itself inherits from Open Zeppelin's AccessControl. Permissions defines some roles and handles initial setup (ensuring timelock and admin have correct access etc). Each contract can additionally define its own roles.

This contract also defines emergency withdraw functionality that only the TIMELOCK_ROLE can call. This is done as a layer of protection while still allowing withdrawing the funds in case of genuine reason.

A simple notSameBlock modifier also exists here that guards against re-entrancy from the same address. Eg blocking an address from bonding and unbonding in the same tx to avoid flashloan risks.
