# Harvest estimate

`growup-harvest-1.0.0` estimates primary harvest mass and farm-gate value from the **counted plants** in the selected layout, plus sourced derivatives (olive oil, carob kernel, wine). It is a planning range, not a mill, winery, PDO or cultivar forecast.

## Method

- Per-tree mature kg (low / base / high) from `src/data/harvestCatalogue.ts`.
- Zero until `productiveFromYear`, then a linear ramp to `plateauYear`.
- Irrigation, when the project has a positive annual water volume, applies `irrigatedFactor` to the base and high bounds.
- Olive oil = olive fruit × 0.1925 (IOC 2015). Wine = grapes × 0.733 kg/kg (~1.35 kg grapes per litre).
- Value uses dated USD snapshots converted with the project exchange rate. Users may override local €/kg.
- Species without a record are omitted from totals (unknown, not zero).
- FAOSTAT t/ha is never multiplied by Growup `treesPerHectare`. Mixed designs are not dedicated groves.

Horizon: years 1–30. Alternate-bearing crops (olive, carob, pistachio) keep a wide low–high band.

## v1 taxa

Olive, carob, almond, grape/wine, fig, sweet orange, lemon, mandarin, pistachio, prickly pear.
